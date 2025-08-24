# wsgi.py
import eventlet
# Apply the monkey patch AT THE VERY TOP
eventlet.monkey_patch()

from server import app, socketio

if __name__ == "__main__":
    socketio.run(app)
