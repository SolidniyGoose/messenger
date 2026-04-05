// Справочник: Никнейм -> ID Сокета
const onlineUsers = new Map(); 

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Новое физическое подключение: ${socket.id}`);

        // 1. Клиент сообщает, как его зовут
        socket.on('register_user', (username) => {
            onlineUsers.set(username, socket.id);
            console.log(`👤 Пользователь ${username} привязан к сокету ${socket.id}`);
        });

        // 2. Обработка зашифрованных сообщений
        socket.on('send_message', (data) => {
            try {
                // Сервер читает только "конверт"
                const payload = JSON.parse(data.text);
                
                // Ищем сокет получателя
                const recipientSocketId = onlineUsers.get(payload.recipient);

                if (recipientSocketId) {
                    // Отправляем ТОЛЬКО адресату! Больше никакого бродкаста.
                    io.to(recipientSocketId).emit('receive_message', data);
                    console.log(`✉️ Зашифрованный пакет ушел: ${payload.sender} -> ${payload.recipient}`);
                } else {
                    console.log(`⚠️ Сообщение не доставлено: ${payload.recipient} не в сети.`);
                    // Здесь можно добавить логику сохранения в БД для офлайн-доставки
                }
            } catch (e) {
                console.error("Ошибка маршрутизации сообщения:", e);
            }
        });

        // 3. Обработка отключения
        socket.on('disconnect', () => {
            // Ищем, кто именно отключился, и удаляем из справочника
            for (let [username, id] of onlineUsers.entries()) {
                if (id === socket.id) {
                    onlineUsers.delete(username);
                    console.log(`❌ Пользователь ушел в офлайн: ${username}`);
                    break;
                }
            }
        });
    });
};