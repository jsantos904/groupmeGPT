const IncomingStream = require('./IncomingStream');

// Replace these with your actual access token, userid, and groupids
const accessToken = 'YOUR_ACCESS_TOKEN';
const userId = 'YOUR_USER_ID';
const groupIds = ['GROUP_ID_1', 'GROUP_ID_2'];

const stream = new IncomingStream(accessToken, userId, groupIds);

stream.on('status', (status) => {
    console.log('Status:', status);
});

stream.on('error', (error) => {
    console.error('Error:', error);
});

stream.on('groupMessage', (groupId, message) => {
    console.log(`Message from group ${groupId}:`, message);
});

// Connect to the WebSocket server
stream.connect();
