module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Новый пользователь: ${socket.id}`);

        // Слушаем входящие сообщения от клиента
        socket.on('send_message', (data) => {
            console.log(`💬 Сообщение от ${socket.id}: ${data.text}`);
            
            // Пересылаем сообщение всем подключенным клиентам (включая отправителя)
            io.emit('receive_message', {
                senderId: socket.id,
                text: data.text,
                timestamp: new Date().toLocaleTimeString()
            });
        });

        socket.on('disconnect', () => {
            console.log(`❌ Пользователь отключился: ${socket.id}`);
        });
    });
};