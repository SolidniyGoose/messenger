const { RoomServiceClient } = require('livekit-server-sdk'); const rs = new RoomServiceClient('https://parketi.ch', 'devkey', 'secret'); rs.listRooms().then(console.log).catch(console.error);  
