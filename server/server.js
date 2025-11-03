// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // tighten this in production
});

const path = require('path');
// Serve static files from the repository root so the main `index.html` is available at '/'
// and the remote UI is available at '/remote/index.html'.
const rootStatic = path.join(__dirname, '..');
app.use(express.static(rootStatic));

// Allow cross-origin requests to /api when the frontend is served from a different port/origin
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  next();
});

let currentRoomCode = null;
// Simple API to generate a short room code for pairing.
function makeRoomCode(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid ambiguous chars
  let out = '';
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

app.get('/api/new-room', (req, res) => {
  const room = makeRoomCode(4);
  currentRoomCode = room;
  console.log('Updated current room code', currentRoomCode);
  res.json({ room });
});

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // source: desktop / remote
  socket.on('join-room', (room, source) => {
    console.log(
      '[',
      source,
      ']',
      socket.id,
      ' is joining room #',
      room,
      'on',
      currentRoomCode,
    );
    return (async () => {
      try {
        if (room === currentRoomCode) {
          socket.join(room);
          // notify other members in the room that a new user joined
          socket.to(room).emit('user-joined', socket.id);
          console.log(`🎊 Success! ${socket.id} joined room ${room}`);

          const res = { success: true, room: room, source: source };

          // send a direct result event to the joining socket to everyone
          io.to(room).emit('join-result', res);
          return res;
        } else {
          const res = { success: false, room, reason: 'room-mismatch' };
          console.log(
            `🎊 Failed! ${socket.id} failed to join room ${room}`,
            'correct room: ',
            currentRoomCode,
          );
          // send a direct failure event to the joining socket
          io.to(room).emit('join-result', res);
          return res;
        }
      } catch (err) {
        const res = {
          success: false,
          room,
          reason: 'error',
          message: String(err),
        };
        socket.emit('join-result', res);
        return res;
      }
    })();
  });

  socket.on('gyro', (data) => {
    // data: { delta: delta, gyro: gyro (just tilting) }
    if (data && data.room) {
      // console.log(`🧭 ${data.delta} |||| ${data.gyro} || by ${socket.id}`);
      // broadcast to others in room (except sender)
      socket.to(data.room).emit('gyro', { ...data, id: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
  });
});

const port = process.env.PORT || 5503;
server.listen(port, () => console.log(`Server running on ${port}`));
