const IncomingStream = require('./IncomingStream');

// Replace these with your actual access token, userid, and groupids
const accessToken = 'YOUR_ACCESS_TOKEN';
const userId = 'YOUR_USER_ID';

const stream = new IncomingStream(accessToken, userId);

stream.on('status', (status) => {
    console.log('Status:', status);
});

stream.on('error', (error) => {
    console.error('Error:', error);
});

stream.on('groupMessage', (message) => {
    console.log(message);
});

// Connect to the WebSocket server
stream.connect();
