const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const onlineUsers = new Map(); 

module.exports = (io) => {
    io.on('connection', (socket) => {
        
        // --- ОБНОВЛЕННАЯ РЕГИСТРАЦИЯ СОКЕТА ---
        socket.on('register_user', async (username) => {
            try {
                // Проверяем, существует ли пользователь в базе данных
                const userExists = await prisma.user.findUnique({
                    where: { username: username }
                });

                if (!userExists) {
                    // Если базы нет (сделали clear.js), приказываем браузеру выйти!
                    socket.emit('force_logout');
                    return;
                }

                onlineUsers.set(username, socket.id);
            } catch (e) {
                console.error("Ошибка при проверке пользователя:", e);
            }
        });

        // ... (дальше идут ваши старые socket.on('send_message') и т.д.)

        socket.on('send_message', async (data) => {
            try {
                const payload = JSON.parse(data.text);
                const recipientSocketId = onlineUsers.get(payload.recipient);

                await prisma.message.create({
                    data: {
                        sender: payload.sender,
                        recipient: payload.recipient,
                        secretBox: payload.secretBox,
                        isRead: false // По умолчанию не прочитано
                    }
                });

                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('receive_message', data);
                }
            } catch (e) { console.error("Ошибка маршрутизации:", e); }
        });

        // --- НОВОЕ: ОБРАБОТКА ПРОЧИТАННЫХ СООБЩЕНИЙ ---
        socket.on('mark_read', async ({ sender, recipient }) => {
            try {
                // В БД помечаем все сообщения от sender к recipient как прочитанные
                await prisma.message.updateMany({
                    where: { sender: sender, recipient: recipient, isRead: false },
                    data: { isRead: true }
                });
                
                // Если отправитель онлайн - мгновенно говорим ему нарисовать две галочки
                const senderSocketId = onlineUsers.get(sender);
                if (senderSocketId) {
                    io.to(senderSocketId).emit('messages_were_read', { by: recipient });
                }
            } catch (e) { console.error("Ошибка статуса:", e); }
        });

        socket.on('disconnect', () => {
            for (let [username, id] of onlineUsers.entries()) {
                if (id === socket.id) {
                    onlineUsers.delete(username);
                    break;
                }
            }
        });
    });
};