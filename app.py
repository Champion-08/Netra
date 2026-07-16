import sys
import io
import json
import math
import random
from datetime import datetime, timedelta
from functools import wraps
from collections import Counter, defaultdict

from flask import (
    Flask, render_template, request, redirect, url_for, flash, 
    session, jsonify, send_file, make_response
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user, 
    login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
import bcrypt

# -------------------------------------------------------------------
# APP CONFIG
# -------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = 'dev-secret-key-change-in-production'  # replace!
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///netra.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# -------------------------------------------------------------------
# DATABASE MODELS
# -------------------------------------------------------------------
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='analyst')  # admin, investigator, analyst
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Crime(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.DateTime, nullable=False)
    crime_type = db.Column(db.String(50), nullable=False)
    district = db.Column(db.String(50), nullable=False)
    lat = db.Column(db.Float, nullable=False)
    lon = db.Column(db.Float, nullable=False)
    suspect = db.Column(db.String(100), default='Unknown')
    victim = db.Column(db.String(100), default='Unknown')
    modus_operandi = db.Column(db.String(100), default='N/A')
    severity = db.Column(db.Integer, default=3)
    anomaly = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'date': self.date.isoformat(),
            'crime_type': self.crime_type,
            'district': self.district,
            'lat': self.lat,
            'lon': self.lon,
            'suspect': self.suspect,
            'victim': self.victim,
            'modus_operandi': self.modus_operandi,
            'severity': self.severity,
            'anomaly': self.anomaly,
        }

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# -------------------------------------------------------------------
# HELPER: role required
# -------------------------------------------------------------------
def role_required(role):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for('login'))
            if current_user.role != role and current_user.role != 'admin':
                flash('Insufficient permissions.', 'error')
                return redirect(url_for('dashboard'))
            return f(*args, **kwargs)
        return decorated
    return decorator

# -------------------------------------------------------------------
# INIT DB & SEED DATA
# -------------------------------------------------------------------
def init_db():
    db.create_all()
    if User.query.count() == 0:
        # create admin user
        admin = User(
            username='admin',
            email='admin@netra.gov.in',
            role='admin'
        )
        admin.set_password('admin123')
        db.session.add(admin)

        # create investigator and analyst
        inv = User(username='investigator', email='inv@netra.gov.in', role='investigator')
        inv.set_password('inv123')
        db.session.add(inv)
        ana = User(username='analyst', email='ana@netra.gov.in', role='analyst')
        ana.set_password('ana123')
        db.session.add(ana)
        db.session.commit()

    if Crime.query.count() == 0:
        # Load synthetic data from CSV if available, else generate
        try:
            df = pd.read_csv('synthetic_crimes.csv')
            for _, row in df.iterrows():
                crime = Crime(
                    date=pd.to_datetime(row['date']),
                    crime_type=row['crime_type'],
                    district=row['district'],
                    lat=row['lat'],
                    lon=row['lon'],
                    suspect=row.get('suspect', 'Unknown'),
                    victim=row.get('victim', 'Unknown'),
                    modus_operandi=row.get('modus_operandi', 'N/A'),
                    severity=int(row.get('severity', 3)),
                    anomaly=bool(int(row.get('anomaly', 0)))
                )
                db.session.add(crime)
            db.session.commit()
            print("[NETRA] Seeded from synthetic_crimes.csv")
        except Exception as e:
            print(f"[NETRA] Could not load CSV: {e}. Generating synthetic data...")
            generate_synthetic_crimes(100)
            db.session.commit()

def generate_synthetic_crimes(n=100):
    from faker import Faker
    fake = Faker('en_IN')
    districts = ['Bengaluru Urban', 'Mysuru', 'Mangaluru', 'Belagavi', 'Hubballi',
                 'Kalaburagi', 'Vijayapura', 'Tumakuru', 'Shivamogga', 'Ballari']
    crime_types = ['Theft', 'Assault', 'Cyber Crime', 'Burglary', 'Fraud', 'Vandalism', 'Drug Offense']
    mo = ['Pickpocket', 'Snatch & run', 'Shop-lift', 'Vehicle theft', 'Phishing', 'Lock break',
          'Weapon use', 'Domestic', 'Road-rage', 'Graffiti', 'Property damage', 'Ransomware',
          'OTP fraud', 'UPI scam', 'Distraction', 'Fake identity', 'Peddling', 'Trafficking',
          'Ponzi', 'Cheque bounce', 'Impersonation', 'SIM swap', 'Window entry', 'Arson attempt']
    suspects = ['Nihal Shere', 'Devika Rastogi', 'Viraj Tiwari', 'Ayushman Chander',
                'Devansh Nigam', 'Priya Rastogi', 'Saumya Mall', 'Ekavir Bhargava',
                'Diya Rattan', 'Janaki Handa', 'Kevin Solanki', 'Daksh Karnik',
                'Janya Gaba', 'Fariq Kaul', 'Dominic Kakar', 'Gagan Sami', 'Chakradev Kari',
                'Unni Bhagat', 'Nathaniel Sami', 'Ranveer Yadav', 'Aryan Maharaj',
                'Gayathri Chaudry', 'Udant Dewan', 'Faqid Savant', 'Hemangini Lalla',
                'Girik Khalsa', 'Tripti Yadav', 'Ekbal Garg', 'Tara Dhar', 'Liam Koshy',
                'Simon Tata', 'Kritika Brar', 'Dakshesh Trivedi', 'Anamika Kanda',
                'Arunima Dugal', 'Kevin Palla', 'Lajita Chatterjee', 'Abhiram Mistry',
                'Pallavi Malhotra', 'Mohammed Gupta']
    victims = ['Kabir Soman', 'Raksha Varughese', 'Jai Kota', 'Ekiya Suresh',
               'Yashica Cherian', 'Victor Kannan', 'Alka Wable', 'Ekansh Balay',
               'Ekavir Varkey', 'Arya Sunder', 'Urvashi Ray', 'Upadhriti Wadhwa',
               'Girindra Chatterjee', 'Devansh Rajan', 'Radhika Dugar', 'Irya Sampath',
               'Ekapad Walia', 'Darsh Rau', 'Ikbal Kothari', 'Logan Sami', 'Yashica Issac',
               'Arya Shere', 'Gavin Batta', 'Advay Contractor', 'Chandresh Zachariah',
               'Michael Dutta', 'Niharika Sunder', 'Tanay Rattan', 'Wriddhish Bhardwaj',
               'Nitesh Raghavan', 'Madhavi Lanka', 'Bhavika Sampath', 'Farhan Chada',
               'Aarush Lall', 'Teerth Bhardwaj', 'Dipta Bhandari', 'Vansha Thakkar',
               'Quincy Biswas', 'Kashvi Edwin', 'Harini Choudhury', 'Wahab Raval',
               'Yatin Baral', 'Oni Virk', 'Advika Jayaraman', 'William Lanka',
               'Karan Mital', 'Tara Chaudhry', 'Tanay Toor', 'Yash Pingle',
               'Nakul Sarma', 'Siddharth Zacharia', 'Krish Lalla', 'Hredhaan Dugal',
               'Baghyawati Kade', 'Samar Lalla', 'Zayan Behl', 'Aarush Nath',
               'Adweta Edwin', 'Prisha Andra']

    for _ in range(n):
        d = random.choice(districts)
        lat = 12.5 + (15.5 - 12.5) * random.random()
        lon = 74.5 + (78.5 - 74.5) * random.random()
        # make some clusters around districts
        if random.random() > 0.3:
            # approximate district centroids
            centroids = {
                'Bengaluru Urban': (12.9716, 77.5946),
                'Mysuru': (12.2958, 76.6394),
                'Mangaluru': (12.9141, 74.8560),
                'Belagavi': (15.8497, 74.4977),
                'Hubballi': (15.3647, 75.1239),
                'Kalaburagi': (17.3297, 76.8343),
                'Vijayapura': (16.8300, 75.7100),
                'Tumakuru': (13.3411, 77.1017),
                'Shivamogga': (13.9299, 75.5681),
                'Ballari': (15.1394, 76.9213),
            }
            if d in centroids:
                lat = centroids[d][0] + (random.random() - 0.5) * 0.8
                lon = centroids[d][1] + (random.random() - 0.5) * 0.8
        crime = Crime(
            date=datetime.now() - timedelta(days=random.randint(0, 365)),
            crime_type=random.choice(crime_types),
            district=d,
            lat=lat,
            lon=lon,
            suspect=random.choice(suspects),
            victim=random.choice(victims),
            modus_operandi=random.choice(mo),
            severity=random.randint(1, 5),
            anomaly=False  # will be set later by Isolation Forest
        )
        db.session.add(crime)
    db.session.commit()
    # Run anomaly detection on the synthetic data
    detect_anomalies()

# -------------------------------------------------------------------
# MACHINE LEARNING FUNCTIONS
# -------------------------------------------------------------------
def get_crimes_df():
    crimes = Crime.query.all()
    data = [c.to_dict() for c in crimes]
    df = pd.DataFrame(data)
    if df.empty:
        return df
    df['date'] = pd.to_datetime(df['date'])
    # compute numeric features for anomaly detection: hour, day_of_week, lat, lon, severity
    df['hour'] = df['date'].dt.hour
    df['day_of_week'] = df['date'].dt.dayofweek
    return df

def detect_anomalies():
    df = get_crimes_df()
    if df.empty:
        return
    # features for Isolation Forest
    features = df[['lat', 'lon', 'hour', 'day_of_week', 'severity']].values
    scaler = StandardScaler()
    features_scaled = scaler.fit_transform(features)
    model = IsolationForest(contamination=0.08, random_state=42)
    preds = model.fit_predict(features_scaled)
    # -1 = anomaly
    anomaly_ids = df[preds == -1]['id'].tolist()
    # update database
    for cid in anomaly_ids:
        crime = Crime.query.get(cid)
        if crime:
            crime.anomaly = True
    # set all others to False
    normal_ids = df[preds == 1]['id'].tolist()
    for cid in normal_ids:
        crime = Crime.query.get(cid)
        if crime:
            crime.anomaly = False
    db.session.commit()

def get_district_centroids():
    # compute average lat/lon per district
    df = get_crimes_df()
    if df.empty:
        return {}
    centroids = df.groupby('district')[['lat', 'lon']].mean().to_dict(orient='index')
    # fallback for districts without crimes
    all_districts = ['Bengaluru Urban', 'Mysuru', 'Mangaluru', 'Belagavi', 'Hubballi',
                     'Kalaburagi', 'Vijayapura', 'Tumakuru', 'Shivamogga', 'Ballari']
    default_centroids = {
        'Bengaluru Urban': (12.9716, 77.5946),
        'Mysuru': (12.2958, 76.6394),
        'Mangaluru': (12.9141, 74.8560),
        'Belagavi': (15.8497, 74.4977),
        'Hubballi': (15.3647, 75.1239),
        'Kalaburagi': (17.3297, 76.8343),
        'Vijayapura': (16.8300, 75.7100),
        'Tumakuru': (13.3411, 77.1017),
        'Shivamogga': (13.9299, 75.5681),
        'Ballari': (15.1394, 76.9213),
    }
    for d in all_districts:
        if d not in centroids and d in default_centroids:
            centroids[d] = {'lat': default_centroids[d][0], 'lon': default_centroids[d][1]}
    return centroids

def get_forecast():
    df = get_crimes_df()
    if df.empty:
        return []
    # calculate recent (last 60 days) crime count per district and severity
    now = datetime.now()
    cutoff = now - timedelta(days=60)
    recent = df[df['date'] >= cutoff]
    district_stats = {}
    all_districts = df['district'].unique()
    for d in all_districts:
        d_recent = recent[recent['district'] == d]
        count = len(d_recent)
        avg_sev = d_recent['severity'].mean() if len(d_recent) > 0 else 0
        # risk score: combine count and severity
        score = count * 0.7 + avg_sev * 0.3
        if score > 10:
            risk = 'High'
            color = '#ff0055'
        elif score > 5:
            risk = 'Medium'
            color = '#ff8c00'
        else:
            risk = 'Low'
            color = '#00e5ff'
        district_stats[d] = {
            'risk': risk,
            'color': color,
            'score': round(score, 2),
            'recent_count': count,
            'avg_severity': round(avg_sev, 2)
        }
    # build GeoJSON features with polygons (circle approximations)
    features = []
    centroids = get_district_centroids()
    for d, stats in district_stats.items():
        if d not in centroids:
            continue
        lat = centroids[d]['lat']
        lon = centroids[d]['lon']
        # create a small square polygon around centroid (approx 0.5 degree = ~55km)
        delta = 0.5
        coords = [
            [lon - delta, lat - delta],
            [lon + delta, lat - delta],
            [lon + delta, lat + delta],
            [lon - delta, lat + delta],
            [lon - delta, lat - delta]  # close
        ]
        geometry = {
            'type': 'Polygon',
            'coordinates': [coords]
        }
        properties = {
            'district': d,
            'risk': stats['risk'],
            'color': stats['color'],
            'score': stats['score'],
            'recent_count': stats['recent_count'],
            'avg_severity': stats['avg_severity']
        }
        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': properties
        })
    return features

# -------------------------------------------------------------------
# ROUTES - PAGES
# -------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            login_user(user)
            flash('Login successful.', 'success')
            return redirect(url_for('dashboard'))
        flash('Invalid email or password.', 'error')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        confirm = request.form.get('confirm_password')
        if password != confirm:
            flash('Passwords do not match.', 'error')
            return render_template('register.html')
        if User.query.filter_by(email=email).first():
            flash('Email already registered.', 'error')
            return render_template('register.html')
        if User.query.filter_by(username=username).first():
            flash('Username taken.', 'error')
            return render_template('register.html')
        user = User(username=username, email=email, role='analyst')
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        flash('Account created. You can now log in.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out.', 'info')
    return redirect(url_for('index'))

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    if request.method == 'POST':
        current_pw = request.form.get('current_password')
        new_pw = request.form.get('new_password')
        confirm = request.form.get('confirm_password')
        if not current_user.check_password(current_pw):
            flash('Current password is incorrect.', 'error')
            return render_template('profile.html', user=current_user)
        if new_pw != confirm:
            flash('Passwords do not match.', 'error')
            return render_template('profile.html', user=current_user)
        if len(new_pw) < 6:
            flash('Password must be at least 6 characters.', 'error')
            return render_template('profile.html', user=current_user)
        current_user.set_password(new_pw)
        db.session.commit()
        flash('Password updated successfully.', 'success')
        return redirect(url_for('profile'))
    return render_template('profile.html', user=current_user)

@app.route('/admin/users')
@login_required
@role_required('admin')
def admin_users():
    users = User.query.all()
    return render_template('admin_users.html', users=users)

@app.route('/admin/promote/<int:user_id>', methods=['POST'])
@login_required
@role_required('admin')
def promote_user(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('Cannot promote yourself.', 'error')
        return redirect(url_for('admin_users'))
    if user.role == 'admin':
        flash('User is already admin.', 'info')
    else:
        user.role = 'admin'
        db.session.commit()
        flash(f'{user.username} promoted to admin.', 'success')
    return redirect(url_for('admin_users'))

@app.route('/admin/delete/<int:user_id>', methods=['POST'])
@login_required
@role_required('admin')
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        flash('Cannot delete yourself.', 'error')
        return redirect(url_for('admin_users'))
    db.session.delete(user)
    db.session.commit()
    flash(f'User {user.username} deleted.', 'success')
    return redirect(url_for('admin_users'))

@app.route('/crime/<int:crime_id>')
@login_required
def crime_detail(crime_id):
    crime = Crime.query.get_or_404(crime_id)
    return render_template('crime_detail.html', crime=crime)

@app.route('/offender/<name>')
@login_required
def offender_profile(name):
    return render_template('offender.html', offender_name=name)

@app.route('/hotspots')
@login_required
def hotspots_page():
    return render_template('hotspots.html')

@app.route('/report', methods=['GET', 'POST'])
@login_required
@role_required('investigator')
def report_crime():
    if request.method == 'POST':
        crime_type = request.form.get('crime_type')
        district = request.form.get('district')
        date_str = request.form.get('date')
        time_str = request.form.get('time')
        lat = float(request.form.get('lat'))
        lon = float(request.form.get('lon'))
        suspect = request.form.get('suspect', 'Unknown')
        victim = request.form.get('victim', 'Unknown')
        modus = request.form.get('modus_operandi', 'N/A')
        severity = int(request.form.get('severity', 3))
        try:
            date = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        except:
            flash('Invalid date/time format.', 'error')
            return render_template('report_crime.html', now=datetime.now(),
                                   districts=get_district_centroids().keys(),
                                   crime_types=['Theft','Assault','Cyber Crime','Burglary','Fraud','Vandalism','Drug Offense'])
        crime = Crime(
            date=date,
            crime_type=crime_type,
            district=district,
            lat=lat,
            lon=lon,
            suspect=suspect,
            victim=victim,
            modus_operandi=modus,
            severity=severity,
            anomaly=False
        )
        db.session.add(crime)
        db.session.commit()
        detect_anomalies()  # re-run anomaly detection
        flash('Crime reported successfully.', 'success')
        return redirect(url_for('dashboard'))
    districts = list(get_district_centroids().keys())
    crime_types = ['Theft','Assault','Cyber Crime','Burglary','Fraud','Vandalism','Drug Offense']
    return render_template('report_crime.html', now=datetime.now(),
                           districts=districts, crime_types=crime_types)

# -------------------------------------------------------------------
# API ENDPOINTS
# -------------------------------------------------------------------
@app.route('/api/crimes')
def api_crimes():
    district = request.args.get('district', 'all')
    crime_type = request.args.get('crime', 'all')
    query = Crime.query
    if district != 'all':
        query = query.filter_by(district=district)
    if crime_type != 'all':
        query = query.filter_by(crime_type=crime_type)
    crimes = query.all()
    features = []
    for c in crimes:
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [c.lon, c.lat]
            },
            'properties': c.to_dict()
        })
    # meta
    all_crimes = Crime.query.all()
    total = len(all_crimes)
    anomalies = sum(1 for c in all_crimes if c.anomaly)
    districts = sorted({c.district for c in all_crimes})
    crime_types = sorted({c.crime_type for c in all_crimes})
    return jsonify({
        'type': 'FeatureCollection',
        'features': features,
        'meta': {
            'total': total,
            'anomalies': anomalies,
            'districts': districts,
            'crime_types': crime_types
        }
    })

@app.route('/api/heatmap')
def api_heatmap():
    district = request.args.get('district', 'all')
    crime_type = request.args.get('crime', 'all')
    query = Crime.query
    if district != 'all':
        query = query.filter_by(district=district)
    if crime_type != 'all':
        query = query.filter_by(crime_type=crime_type)
    crimes = query.all()
    # return list of [lat, lon, intensity] (intensity = severity/5)
    points = [[c.lat, c.lon, c.severity / 5.0] for c in crimes]
    return jsonify({'points': points})

@app.route('/api/cluster')
def api_cluster():
    # use DBSCAN on all crimes
    df = get_crimes_df()
    if df.empty:
        return jsonify({'clusters': []})
    coords = df[['lat', 'lon']].values
    # scale coordinates (approx 1 degree ~ 111 km)
    scaler = StandardScaler()
    coords_scaled = scaler.fit_transform(coords)
    dbscan = DBSCAN(eps=0.06, min_samples=3)
    labels = dbscan.fit_predict(coords_scaled)
    df['cluster'] = labels
    clusters = []
    for label in set(labels):
        if label == -1:
            continue
        cluster_df = df[df['cluster'] == label]
        lat = cluster_df['lat'].mean()
        lon = cluster_df['lon'].mean()
        count = len(cluster_df)
        anomalies = cluster_df['anomaly'].sum()
        avg_sev = cluster_df['severity'].mean()
        crime_types = cluster_df['crime_type'].value_counts().to_dict()
        districts = cluster_df['district'].value_counts().to_dict()
        top_district = max(districts, key=districts.get) if districts else 'Unknown'
        clusters.append({
            'id': int(label),
            'lat': lat,
            'lon': lon,
            'count': count,
            'anomalies': int(anomalies),
            'avg_severity': round(avg_sev, 2),
            'crime_types': crime_types,
            'district': top_district,
            'districts': districts
        })
    return jsonify({'clusters': clusters})

@app.route('/api/predict')
def api_predict():
    features = get_forecast()
    return jsonify({'type': 'FeatureCollection', 'features': features})

@app.route('/api/network')
def api_network():
    crimes = Crime.query.all()
    nodes = set()
    edges = []
    # Add suspect nodes
    suspect_counts = Counter(c.suspect for c in crimes if c.suspect != 'Unknown')
    for name, count in suspect_counts.items():
        nodes.add(('suspect', name, count))
    # victim nodes
    victim_counts = Counter(c.victim for c in crimes if c.victim != 'Unknown')
    for name, count in victim_counts.items():
        nodes.add(('victim', name, count))
    # location nodes (districts)
    district_counts = Counter(c.district for c in crimes)
    for name, count in district_counts.items():
        nodes.add(('location', name, count))

    # edges: suspect-victim, suspect-location, victim-location
    for c in crimes:
        if c.suspect != 'Unknown' and c.victim != 'Unknown':
            edges.append((c.suspect, c.victim, 'involved_with'))
        if c.suspect != 'Unknown':
            edges.append((c.suspect, c.district, 'operated_in'))
        if c.victim != 'Unknown':
            edges.append((c.victim, c.district, 'victim_in'))

    node_list = []
    for (typ, name, count) in nodes:
        node_list.append({
            'data': {
                'id': f"{typ}_{name}",
                'label': name,
                'type': typ,
                'count': count
            }
        })
    edge_list = []
    edge_id = 0
    for src, tgt, rel in edges:
        src_id = f"suspect_{src}" if src in suspect_counts else f"victim_{src}"
        tgt_id = f"victim_{tgt}" if tgt in victim_counts else f"location_{tgt}"
        # ensure nodes exist
        if any(n['data']['id'] == src_id for n in node_list) and any(n['data']['id'] == tgt_id for n in node_list):
            edge_list.append({
                'data': {
                    'id': f"e{edge_id}",
                    'source': src_id,
                    'target': tgt_id,
                    'label': rel
                }
            })
            edge_id += 1
    return jsonify({'nodes': node_list, 'edges': edge_list})

@app.route('/api/stats')
def api_stats():
    df = get_crimes_df()
    if df.empty:
        return jsonify({
            'trends': {}, 'months': [], 'districts': [], 'district_counts': [],
            'crime_types': [], 'crime_counts': []
        })
    # trends by month and crime type
    df['month'] = df['date'].dt.to_period('M')
    pivot = df.pivot_table(index='month', columns='crime_type', aggfunc='size', fill_value=0)
    pivot = pivot.reindex(sorted(pivot.columns), axis=1)
    months = [str(m) for m in pivot.index]
    trends = {col: pivot[col].tolist() for col in pivot.columns}

    # district counts
    dist_counts = df['district'].value_counts()
    districts = dist_counts.index.tolist()
    district_counts = dist_counts.tolist()

    # crime types counts
    type_counts = df['crime_type'].value_counts()
    crime_types = type_counts.index.tolist()
    crime_counts = type_counts.tolist()

    return jsonify({
        'trends': trends,
        'months': months,
        'districts': districts,
        'district_counts': district_counts,
        'crime_types': crime_types,
        'crime_counts': crime_counts
    })

@app.route('/api/trend_spikes')
def api_trend_spikes():
    df = get_crimes_df()
    if df.empty:
        return jsonify({'spikes': []})
    df['month'] = df['date'].dt.to_period('M')
    # get last two months
    months = sorted(df['month'].unique())
    if len(months) < 2:
        return jsonify({'spikes': []})
    last = months[-1]
    prev = months[-2]
    last_df = df[df['month'] == last]
    prev_df = df[df['month'] == prev]
    crime_types = df['crime_type'].unique()
    spikes = []
    for ct in crime_types:
        last_count = len(last_df[last_df['crime_type'] == ct])
        prev_count = len(prev_df[prev_df['crime_type'] == ct])
        if prev_count > 0:
            change = ((last_count - prev_count) / prev_count) * 100
            if change > 20:  # >20% increase
                spikes.append({
                    'crime_type': ct,
                    'change_pct': round(change, 1),
                    'prev_count': prev_count,
                    'curr_count': last_count,
                    'month': str(last)
                })
    spikes = sorted(spikes, key=lambda x: x['change_pct'], reverse=True)
    return jsonify({'spikes': spikes})

@app.route('/api/socioeconomic')
def api_socioeconomic():
    # Mock socio-economic data for Karnataka districts
    # In production, fetch from real dataset
    df = get_crimes_df()
    if df.empty:
        return jsonify([])
    districts = df['district'].unique()
    # Mock data (unemployment %, literacy %, crime rate per 100k)
    mock = {
        'Bengaluru Urban': {'unemployment': 3.5, 'literacy': 88.5, 'population': 10000000},
        'Mysuru': {'unemployment': 4.2, 'literacy': 82.8, 'population': 3000000},
        'Mangaluru': {'unemployment': 5.1, 'literacy': 86.2, 'population': 2500000},
        'Belagavi': {'unemployment': 6.0, 'literacy': 73.5, 'population': 4800000},
        'Hubballi': {'unemployment': 5.5, 'literacy': 75.0, 'population': 2000000},
        'Kalaburagi': {'unemployment': 7.2, 'literacy': 65.0, 'population': 2500000},
        'Vijayapura': {'unemployment': 6.8, 'literacy': 67.0, 'population': 2200000},
        'Tumakuru': {'unemployment': 5.0, 'literacy': 75.5, 'population': 2700000},
        'Shivamogga': {'unemployment': 4.8, 'literacy': 80.0, 'population': 1700000},
        'Ballari': {'unemployment': 6.5, 'literacy': 63.0, 'population': 2400000},
    }
    result = []
    for d in districts:
        pop = mock.get(d, {}).get('population', 1000000)
        count = len(df[df['district'] == d])
        crime_rate = (count / pop) * 100000
        result.append({
            'district': d,
            'crime_count': count,
            'crime_rate': round(crime_rate, 2),
            'unemployment': mock.get(d, {}).get('unemployment', 5.0),
            'literacy': mock.get(d, {}).get('literacy', 75.0),
        })
    return jsonify(result)

@app.route('/api/modus')
def api_modus():
    df = get_crimes_df()
    if df.empty:
        return jsonify({'top_mo': {}})
    mo_counts = df['modus_operandi'].value_counts().to_dict()
    return jsonify({'top_mo': mo_counts})

@app.route('/api/crimes/table')
def api_crimes_table():
    # pagination, sorting, search
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))
    sort = request.args.get('sort', 'date')
    order = request.args.get('order', 'desc')
    search = request.args.get('search', '').strip()
    district = request.args.get('district', 'all')
    crime_type = request.args.get('crime', 'all')
    anom_only = request.args.get('anom_only', '0') == '1'

    query = Crime.query
    if district != 'all':
        query = query.filter_by(district=district)
    if crime_type != 'all':
        query = query.filter_by(crime_type=crime_type)
    if anom_only:
        query = query.filter_by(anomaly=True)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            db.or_(
                Crime.suspect.ilike(search_term),
                Crime.victim.ilike(search_term),
                Crime.district.ilike(search_term),
                Crime.crime_type.ilike(search_term),
                Crime.modus_operandi.ilike(search_term)
            )
        )
    # sorting
    if sort == 'date':
        sort_col = Crime.date
    elif sort == 'id':
        sort_col = Crime.id
    elif sort == 'crime_type':
        sort_col = Crime.crime_type
    elif sort == 'district':
        sort_col = Crime.district
    elif sort == 'severity':
        sort_col = Crime.severity
    elif sort == 'anomaly':
        sort_col = Crime.anomaly
    else:
        sort_col = Crime.date
    if order == 'desc':
        query = query.order_by(sort_col.desc())
    else:
        query = query.order_by(sort_col.asc())

    total = query.count()
    pages = (total + per_page - 1) // per_page
    if page < 1:
        page = 1
    if page > pages and pages > 0:
        page = pages
    offset = (page - 1) * per_page
    rows = query.offset(offset).limit(per_page).all()

    return jsonify({
        'rows': [r.to_dict() for r in rows],
        'total': total,
        'page': page,
        'pages': pages,
        'per_page': per_page
    })

@app.route('/api/export/csv')
def api_export_csv():
    district = request.args.get('district', 'all')
    crime_type = request.args.get('crime', 'all')
    query = Crime.query
    if district != 'all':
        query = query.filter_by(district=district)
    if crime_type != 'all':
        query = query.filter_by(crime_type=crime_type)
    crimes = query.all()
    data = [c.to_dict() for c in crimes]
    df = pd.DataFrame(data)
    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)
    return send_file(io.BytesIO(output.getvalue().encode('utf-8')),
                     mimetype='text/csv',
                     as_attachment=True,
                     download_name='crimes_export.csv')

@app.route('/api/upload', methods=['POST'])
@login_required
@role_required('admin')
def api_upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'Only CSV files allowed'}), 400
    try:
        content = file.read().decode('utf-8')
        df = pd.read_csv(io.StringIO(content))
        required = {'date', 'crime_type', 'district', 'lat', 'lon'}
        if not required.issubset(set(df.columns)):
            return jsonify({'error': f'CSV must contain: {sorted(required)}'}), 400
        # fill missing columns
        for col, default in [('suspect', 'Unknown'), ('victim', 'Unknown'),
                             ('modus_operandi', 'N/A'), ('severity', 3)]:
            if col not in df.columns:
                df[col] = default
        # insert
        inserted = 0
        for _, row in df.iterrows():
            try:
                date = pd.to_datetime(row['date'])
            except:
                continue
            crime = Crime(
                date=date,
                crime_type=str(row['crime_type']),
                district=str(row['district']),
                lat=float(row['lat']),
                lon=float(row['lon']),
                suspect=str(row['suspect']),
                victim=str(row['victim']),
                modus_operandi=str(row['modus_operandi']),
                severity=int(row['severity']),
                anomaly=False
            )
            db.session.add(crime)
            inserted += 1
        db.session.commit()
        detect_anomalies()
        return jsonify({'ok': True, 'rows': inserted})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/offender/<name>')
def api_offender(name):
    crimes = Crime.query.filter_by(suspect=name).all()
    if not crimes:
        return jsonify({'error': 'Offender not found'}), 404
    total = len(crimes)
    anomalies = sum(1 for c in crimes if c.anomaly)
    avg_sev = sum(c.severity for c in crimes) / total
    victims = sorted({c.victim for c in crimes if c.victim != 'Unknown'})
    crime_types = Counter(c.crime_type for c in crimes)
    modus_operandi = Counter(c.modus_operandi for c in crimes)
    districts = Counter(c.district for c in crimes)
    first_seen = min(c.date for c in crimes).isoformat()
    last_seen = max(c.date for c in crimes).isoformat()
    crimes_list = sorted([c.to_dict() for c in crimes], key=lambda x: x['date'], reverse=True)
    return jsonify({
        'total_crimes': total,
        'anomalies': anomalies,
        'avg_severity': round(avg_sev, 2),
        'victims': victims,
        'first_seen': first_seen,
        'last_seen': last_seen,
        'crime_types': dict(crime_types),
        'modus_operandi': dict(modus_operandi),
        'districts': dict(districts),
        'crimes': crimes_list
    })

@app.route('/api/hotspots')
def api_hotspots():
    df = get_crimes_df()
    if df.empty:
        return jsonify({'hour_matrix': {}, 'dow_counts': [], 'dow_labels': [], 'peaks': {}})
    # hour matrix per district
    df['hour'] = df['date'].dt.hour
    districts = df['district'].unique()
    hour_matrix = {}
    for d in districts:
        hours = df[df['district'] == d]['hour'].value_counts().reindex(range(24), fill_value=0)
        hour_matrix[d] = hours.tolist()
    # day-of-week counts
    dow = df['date'].dt.dayofweek.value_counts().reindex(range(7), fill_value=0)
    dow_labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    # peak per district
    peaks = {}
    for d in districts:
        hours = df[df['district'] == d]['hour']
        if len(hours) == 0:
            continue
        peak_hour = hours.mode()[0]
        peak_count = hours.value_counts().max()
        # night crimes (22-05)
        night = hours[(hours >= 22) | (hours <= 5)]
        night_pct = round(len(night) / len(hours) * 100, 1)
        peaks[d] = {
            'peak_hour': int(peak_hour),
            'peak_count': int(peak_count),
            'night_pct': night_pct
        }
    return jsonify({
        'hour_matrix': hour_matrix,
        'dow_counts': dow.tolist(),
        'dow_labels': dow_labels,
        'peaks': peaks
    })

@app.route('/api/chat', methods=['POST'])
def api_chat():
    data = request.get_json()
    query = data.get('query', '').lower().strip()
    if not query:
        return jsonify({'reply': 'Please ask a question.'})
    # simple rule-based chatbot
    df = get_crimes_df()
    if df.empty:
        return jsonify({'reply': 'No crime data available.'})
    total = len(df)
    anomalies = df['anomaly'].sum()
    districts = df['district'].value_counts()
    crime_types = df['crime_type'].value_counts()

    if 'total' in query or 'count' in query:
        reply = f"Total reported crimes: {total}."
    elif 'anomal' in query:
        reply = f"Detected anomalies: {int(anomalies)} out of {total} incidents (Isolation Forest)."
    elif 'top district' in query or 'district' in query:
        top = districts.head(3)
        reply = "Top districts: " + ", ".join([f"{d} ({c})" for d,c in top.items()])
    elif 'crime type' in query or 'type' in query:
        top = crime_types.head(3)
        reply = "Most common crimes: " + ", ".join([f"{t} ({c})" for t,c in top.items()])
    elif 'cyber' in query:
        cyber = df[df['crime_type'] == 'Cyber Crime']
        reply = f"Cyber crime incidents: {len(cyber)}."
    elif 'recent' in query:
        recent = df.sort_values('date', ascending=False).head(10)
        reply = "Most recent crimes:\n" + "\n".join([f"{r['date'][:10]} - {r['crime_type']} in {r['district']}" for _,r in recent.iterrows()])
    elif 'help' in query:
        reply = "I can answer: total crimes, anomalies, top districts, crime types, cyber, recent, trends, spikes."
    elif 'trend' in query or 'spike' in query:
        # fetch from trend spikes
        spikes = api_trend_spikes().json['spikes']
        if spikes:
            reply = "Recent spikes (>20% increase): " + ", ".join([f"{s['crime_type']} (+{s['change_pct']}%)" for s in spikes[:5]])
        else:
            reply = "No significant spikes detected."
    else:
        reply = "I didn't understand that. Try asking about total crimes, anomalies, top districts, crime types, cyber, recent, trends, or spikes."
    return jsonify({'reply': reply})

@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok', 'service': 'NETRA', 'version': '2.0.0'})

# -------------------------------------------------------------------
# ERROR HANDLERS
# -------------------------------------------------------------------
@app.errorhandler(403)
def forbidden(e):
    return render_template('login.html'), 403

@app.errorhandler(404)
def not_found(e):
    return render_template('index.html'), 404

# -------------------------------------------------------------------
# INIT AND RUN
# -------------------------------------------------------------------
if __name__ == '__main__':
    port = 5000
    for i, arg in enumerate(sys.argv):
        if arg == '--port' and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    with app.app_context():
        init_db()
    print(f"[NETRA v2.0] Starting on 0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)