/************************************************************************
 * Internal Node Modules 
 ***********************************************************************/
const EventEmitter = require('events');

/************************************************************************
 * External Dependencies 
 ***********************************************************************/
const WebSocketClient = require('websocket').client;

/************************************************************************
 * Internal Dependencies 
 ***********************************************************************/
const Constants = require('./Constants');

/************************************************************************
 * Private Constants
 ***********************************************************************/
const STATE_DISCONNECTED = "disconnected";
const STATE_PENDING = "pending";
const STATE_CONNECTED = "connected";

class IncomingStream extends EventEmitter {
    // Constructor initializes the WebSocket client and sets the initial state
    constructor(access_token, userid, groupids) {
        super();
        this.access_token = access_token;
        this.userid = userid;
        this.groupids = groupids;

        this.client = new WebSocketClient();
        this.connection = null;
        this.socketId = 1;
        this.state = STATE_DISCONNECTED;

        // Event listeners for WebSocket client
        this.client.on('connect', connection => this.handleConnection(connection));
        this.client.on('connectFailed', error => this.handleConnectionFailed(error));
    }

    // Connects to the WebSocket server
    connect() {
        if (this.connection && this.state === STATE_CONNECTED) return;
        this.client.connect(Constants.WEBSOCKETS_BASEURL);
    }

    // Disconnects from the WebSocket server
    disconnect() {
        this.stopHealthCheck(); // Stop health checks when disconnecting
        if (this.connection) this.connection.close();
        this.emit('status', 'Sending disconnect request to server.');
    }
    

    // Emits an error event
    handleError(str, payload) {
        this.emit('error', str, payload);
    }

    // Sets the current state and emits it as an event
    setState(state) {
        this.state = state;
        this.emit(state);
    }

    // Initiates the handshake process with the server
    handshake() {
        const data = {
            channel: '/meta/handshake',
            version: '1.0',
            supportedConnectionTypes: ['websocket', 'callback-polling']
        };
        this.send([data]);
    }

    // Handles the response to the handshake
    handshakeResponse(data) {
        if (data["successful"]) {
            this.emit('status', 'Handshake succeeded!');
            this.clientId = data["clientId"];
            this.subscribeUser();
        } else {
            this.emit('error', 'Handshake failed! Retrying...');
            // Retry handshake after a delay
            setTimeout(() => this.handshake(), 5000); // Retry after 5 seconds
        }
    }
    

    // Subscribes to user updates
    subscribeUser() {
        const data = {
            channel: '/meta/subscribe',
            clientId: this.clientId,
            subscription: '/user/' + this.userid,
            ext: {
                access_token: this.access_token,
                timestamp: Date.now()
            }
        };
        this.send([data]);
    }

    // Handles the response to subscription requests
    subscribeResponse(data) {
        if (data["successful"]) {
            this.startListening();
            if (data["subscription"] === '/user/' + this.userid && this.groupids) {
                this.subscribeGroups();
            }
        } else {
            this.emit('error', 'Subscribing to user or group failed!');
        }
    }

    // Subscribes to group updates
    subscribeGroups() {
        this.groupids.forEach(groupid => {
            const data = {
                channel: '/meta/subscribe',
                clientId: this.clientId,
                subscription: '/group/' + groupid,
                ext: {
                    access_token: this.access_token,
                    timestamp: Date.now()
                }
            };
            this.send([data]);
        });
    }

    // Starts listening for messages
    startListening() {
        const data = {
            channel: '/meta/connect',
            clientId: this.clientId,
            connectionType: 'websocket',
        };
        this.send([data]);
        this.setState(STATE_CONNECTED);
    }

    // Sends data to the WebSocket server
    send(data) {
        // Check if the connection is established and open
        if (!this.connection || this.connection.readyState !== this.connection.OPEN) {
            this.emit('error', 'Cannot send message: WebSocket connection is not open.');
            return;
        }

        // Increment and assign IDs to the data
        data.forEach(d => {
            this.socketId++;
            d.id = this.socketId;
        });

        // Attempt to send the data
        try {
            this.emit('status', 'Sending: ', data);
            this.connection.send(JSON.stringify(data));
        } catch (error) {
            // Handle any errors that occur during sending
            this.emit('error', 'Error sending message:', error);
        }
    }


    // Handles the connection to the WebSocket server
    handleConnection(connection) {
        this.setState(STATE_PENDING);
        this.connection = this.initConnection(connection);
        this.emit('status', 'Websocket Connected');
        this.handshake();
        this.startHealthCheck(); // Start the health check process
    }

    // Handles a failed connection to the WebSocket server
    handleConnectionFailed(error) {
        this.setState(STATE_DISCONNECTED);
        this.connection = null;
        this.emit('error', 'Connection Failed', error);
        setTimeout(() => this.connect(), 5000);
    }

    startHealthCheck() {
        this.healthCheckInterval = setInterval(() => {
            if (this.connection) {
                try {
                    this.connection.ping(); // Send a ping
                } catch (error) {
                    this.emit('error', 'Failed to ping. Reconnecting...');
                    this.connect();
                }
            }
        }, 30000); // Send a ping every 30 seconds
    }

    // Initializes the connection to the WebSocket server
    initConnection(connection) {
        connection.on('close', (reasonCode, description) => {
            this.stopHealthCheck(); // Stop health checks on connection close
            this.emit('status', 'Websocket Disconnected.', description);
            this.connection = null;
            this.setState(STATE_DISCONNECTED);
            setTimeout(() => this.connect(), 5000);
        });

        connection.on('error', error => this.handleError("Websocket experienced error.", error));

        connection.on('message', msg => {
            // If the message is a utf8 message, parse it and emit it as an event
            if (msg.type === 'utf8' && msg.utf8Data) {
                this.emit('status', 'Received:', msg);
                JSON.parse(msg.utf8Data).forEach(data => {
                    if (data["channel"] === "/meta/handshake") {
                        this.handshakeResponse(data);
                    } else if (data["channel"] === "/meta/subscribe") {
                        this.subscribeResponse(data);
                    } else if (data["error"] && data["error"] === "ClientID_Expired") { // Check for client ID expiration
                        this.emit('error', 'ClientID expired. Initiating new handshake.');
                        this.handshake();
                    } else {
                        // Handle other messages, possibly with groupId
                        if (data.groupId) { // Check if the message has a groupId field
                            this.emit('groupMessage', data.groupId, data);
                        } else {
                            this.emit('message', data);
                        }
                    }
                });
            } else {
                this.emit('error', 'Received a non-utf8 message.', msg);
            }
        });

        return connection;
    }
}

module.exports = IncomingStream;
