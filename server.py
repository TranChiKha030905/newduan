import eventlet
eventlet.monkey_patch()
import os
from flask import Flask, render_template, request, redirect, url_for, flash
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
import uuid # Thư viện để tạo mã phòng ngẫu nhiên

# --- CẤU HÌNH ỨNG DỤNG VÀ DATABASE ---
app = Flask(__name__)
app.config['SECRET_KEY'] = 'a_super_secret_key_that_should_be_changed'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- CẤU HÌNH HỆ THỐNG LOGIN ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# --- ĐỊNH NGHĨA MODEL DATABASE ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(150), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# --- CÁC ROUTE XÁC THỰC VÀ PHÒNG HỌP ---

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        else:
            flash('Invalid username or password')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if User.query.filter_by(username=username).first():
            flash('Username already exists')
        else:
            new_user = User(username=username)
            new_user.set_password(password)
            db.session.add(new_user)
            db.session.commit()
            flash('Registration successful! Please log in.')
            return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/new-room')
@login_required
def new_room():
    # Tạo một mã phòng ngẫu nhiên và duy nhất
    room_id = str(uuid.uuid4().hex)[:6]
    return redirect(url_for('room', room_id=room_id))

@app.route('/room/<room_id>')
@login_required
def room(room_id):
    # Trang vào phòng họp
    return render_template('room.html', room_id=room_id)

# --- LOGIC SOCKET.IO CHO VIDEO CALL ---

rooms = {}
sid_to_user = {} # **MỚI**: Dictionary để map sid với username

@socketio.on('connect')
@login_required
def on_connect():
    sid_to_user[request.sid] = current_user.username
    print(f"Client connected: {current_user.username} ({request.sid})")

@socketio.on('disconnect')
def on_disconnect():
    username = sid_to_user.get(request.sid, 'Unknown')
    print(f"Client disconnected: {username} ({request.sid})")
    
    # Xóa người dùng khỏi sid_to_user map
    if request.sid in sid_to_user:
        del sid_to_user[request.sid]

    for room_id, users in rooms.items():
        if request.sid in users:
            users.remove(request.sid)
            leave_room(room_id)
            emit('user-disconnected', {'sid': request.sid, 'username': username}, room=room_id)
            print(f"User {username} left room {room_id}")
            break

@socketio.on('join-room')
@login_required
def on_join_room(data):
    room_id = data.get('room_id')
    if not room_id:
        return

    join_room(room_id)
    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(request.sid)

    # **NÂNG CẤP**: Gửi danh sách người dùng kèm username
    other_users_data = []
    for user_sid in rooms[room_id]:
        if user_sid != request.sid:
            other_users_data.append({
                'sid': user_sid,
                'username': sid_to_user.get(user_sid, 'Guest')
            })

    emit('user-list', {'users': other_users_data})
    emit('user-joined', {'sid': request.sid, 'username': current_user.username}, room=room_id, skip_sid=request.sid)
    print(f"User {current_user.username} joined room {room_id}")

@socketio.on('signal')
def on_signal(data):
    target_sid = data.get('target_sid')
    signal_data = data.get('data')
    emit('signal', {
        'sender_sid': request.sid,
        'data': signal_data
    }, room=target_sid)

# **MỚI**: Thêm logic xử lý chat phía server
@socketio.on('send-message')
@login_required
def on_send_message(data):
    room_id = data.get('room_id')
    message = data.get('message')
    if room_id in rooms:
        emit('receive-message', {
            'sender_username': current_user.username,
            'message': message
        }, room=room_id)

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, ssl_context=('cert.pem', 'key.pem'))
    @app.cli.command("init-db")
def init_db_command():
    """Tạo các bảng trong database."""
    db.create_all()
    print("Đã khởi tạo database.")
