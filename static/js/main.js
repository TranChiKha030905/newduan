document.addEventListener('DOMContentLoaded', () => {
    // Thêm console.log để biết script đã chạy
    console.log("Script loaded. Connecting to server...");

    const socket = io.connect(`https://${document.domain}:${location.port}`);

    let localStream;
    let cameraStream; // Dùng để lưu lại luồng camera khi chia sẻ màn hình
    let isScreenSharing = false;
    const peerConnections = {};
    const peerUsers = {};

    const config = {
        'iceServers': [{ 'urls': ['stun:stun.l.google.com:1932'] }] // Cập nhật port STUN
    };

    // Lấy các element từ HTML
    const localVideo = document.getElementById('local-video');
    const videoGrid = document.getElementById('video-grid');
    const toggleMicBtn = document.getElementById('toggle-mic-btn');
    const toggleVideoBtn = document.getElementById('toggle-video-btn');
    const shareScreenBtn = document.getElementById('share-screen-btn');
    const chatInput = document.getElementById('chat-input-msg');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const messagesDiv = document.getElementById('messages');
    const inviteLinkInput = document.getElementById('invite-link-input');
    const copyInviteBtn = document.getElementById('copy-invite-btn');
    inviteLinkInput.value = window.location.href;
    const sendImageBtn = document.getElementById('send-image-btn');
    const imageInput = document.getElementById('image-input');

    // Xử lý sự kiện nhấn nút sao chép
    copyInviteBtn.addEventListener('click', () => {
        // Chọn nội dung trong ô input
        inviteLinkInput.select();
        inviteLinkInput.setSelectionRange(0, 99999); // Dành cho di động

        // Sao chép vào clipboard
        navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
            // Thông báo cho người dùng đã sao chép thành công
            copyInviteBtn.textContent = 'Đã chép!';
            setTimeout(() => {
                copyInviteBtn.textContent = 'Sao chép';
            }, 2000); // Reset lại chữ sau 2 giây
        }).catch(err => {
            console.error('Không thể sao chép link: ', err);
        });
    });

    // Bắt đầu cuộc gọi
    async function startCall() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            cameraStream = localStream; // Lưu luồng camera ban đầu
            localVideo.srcObject = localStream;
            console.log("Media devices accessed.");
        } catch (error) {
            console.error('Error accessing media devices.', error);
            alert('Cannot access camera and microphone. Please check permissions.');
            return;
        }
        // Chỉ emit 'join-room' sau khi đã có stream
        socket.emit('join-room', { room_id: ROOM_ID });
        console.log(`Emitting 'join-room' for room: ${ROOM_ID}`);
    }

    // --- Xử lý sự kiện Socket.IO ---

    socket.on('connect', () => {
        console.log("Connected to server with SID:", socket.id);
    });

    socket.on('user-list', (data) => {
        console.log('Received user list:', data.users);
        data.users.forEach(user => {
            peerUsers[user.sid] = user.username;
            createPeerConnection(user.sid, true); // true = isInitiator
        });
    });

    socket.on('user-joined', (data) => {
        console.log('New user joined:', data);
        peerUsers[data.sid] = data.username;
        createPeerConnection(data.sid, false); // false = not initiator
    });

    socket.on('user-disconnected', (data) => {
        console.log('User disconnected:', data);
        if (peerConnections[data.sid]) {
            peerConnections[data.sid].close();
            delete peerConnections[data.sid];
            delete peerUsers[data.sid];
        }
        const videoElement = document.getElementById(`video-${data.sid}`);
        if (videoElement) {
            videoElement.parentElement.remove();
        }
    });

    socket.on('signal', async (data) => {
        const { sender_sid, data: signalData } = data;
        if (!peerConnections[sender_sid]) {
            console.error("Received signal from unknown peer:", sender_sid);
            return;
        }
        const pc = peerConnections[sender_sid];

        if (signalData.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signalData));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { target_sid: sender_sid, data: pc.localDescription });
        } else if (signalData.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signalData));
        } else if (signalData.candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
        }
    });

    // --- Logic WebRTC ---

    function createPeerConnection(targetSid, isInitiator) {
        console.log(`Creating peer connection to ${targetSid}, initiator: ${isInitiator}`);
        const pc = new RTCPeerConnection(config);
        peerConnections[targetSid] = pc;

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { target_sid: targetSid, data: { candidate: event.candidate } });
            }
        };

        pc.ontrack = (event) => {
            let videoElement = document.getElementById(`video-${targetSid}`);
            if (!videoElement) {
                const videoContainer = document.createElement('div');
                videoContainer.classList.add('video-container');
                videoElement = document.createElement('video');
                videoElement.id = `video-${targetSid}`;
                videoElement.autoplay = true;
                videoElement.playsInline = true;
                
                const label = document.createElement('div');
                label.classList.add('video-label');
                label.innerText = peerUsers[targetSid] || 'Guest';
                
                videoContainer.appendChild(videoElement);
                videoContainer.appendChild(label);
                videoGrid.appendChild(videoContainer);
            }
            videoElement.srcObject = event.streams[0];
        };

        if (isInitiator) {
            pc.createOffer()
              .then(offer => pc.setLocalDescription(offer))
              .then(() => {
                  socket.emit('signal', { target_sid: targetSid, data: pc.localDescription });
              });
        }
    }

    // --- Logic Chat ---

    function sendMessage() {
    const message = chatInput.value;
    if (message.trim()) {
        console.log("Sending message:", message);
        // **NÂNG CẤP**: Thêm 'type: text'
        socket.emit('send-message', { 
            room_id: ROOM_ID, 
            message: message,
            type: 'text' 
        });
        displayMessage( 'You', message);
        chatInput.value = '';
    }
}
    

    socket.on('receive-message', (data) => {
    console.log("Received message:", data);

    // **NÂNG CẤP**: Kiểm tra loại tin nhắn
    if (data.type === 'image') {
        displayImage(data.sender_username, data.message);
    } else {
        displayMessage(data.sender_username, data.message);
    }
});

    function displayMessage(sender, message) {
        const msgElement = document.createElement('p');
        // Chống XSS bằng cách không dùng innerHTML trực tiếp với message
        const strong = document.createElement('strong');
        strong.textContent = `${sender}: `;
        msgElement.appendChild(strong);
        msgElement.appendChild(document.createTextNode(message));
        
        messagesDiv.appendChild(msgElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // --- Logic các nút điều khiển (ĐÃ TRẢ LẠI) ---

    toggleMicBtn.addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        toggleMicBtn.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
    });

    toggleVideoBtn.addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        videoTrack.enabled = !videoTrack.enabled;
        toggleVideoBtn.textContent = videoTrack.enabled ? 'Hide Video' : 'Show Video';
    });
    
    shareScreenBtn.addEventListener('click', async () => {
        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                // Thay thế track trong tất cả các kết nối
                for (const sid in peerConnections) {
                    const sender = peerConnections[sid].getSenders().find(s => s.track.kind === 'video');
                    sender.replaceTrack(screenTrack);
                }
                
                localVideo.srcObject = screenStream;
                localStream = screenStream;
                isScreenSharing = true;
                shareScreenBtn.textContent = 'Stop Sharing';
                
                screenTrack.onended = () => stopScreenSharing();
            } catch (err) { console.error("Error sharing screen:", err); }
        } else {
            stopScreenSharing();
        }
    });

    function stopScreenSharing() {
        const cameraTrack = cameraStream.getVideoTracks()[0];
        for (const sid in peerConnections) {
            const sender = peerConnections[sid].getSenders().find(s => s.track.kind === 'video');
            sender.replaceTrack(cameraTrack);
        }
        localVideo.srcObject = cameraStream;
        localStream = cameraStream;
        isScreenSharing = false;
        shareScreenBtn.textContent = 'Share Screen';
    }

    // Gán sự kiện cho nút chat
    sendChatBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    // Khởi động mọi thứ
    startCall();
});