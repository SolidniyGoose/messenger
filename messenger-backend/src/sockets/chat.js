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

        // --- ОБНОВЛЕННАЯ МАРШРУТИЗАЦИЯ СООБЩЕНИЙ ---
        socket.on('send_message', async (data) => {
            try {
                const payload = JSON.parse(data.text);

                if (payload.isGroup) {
                    // === ЛОГИКА ДЛЯ ГРУПП ===
                    
                    // 1. Сохраняем сообщение в БД с привязкой к ID группы
                    await prisma.message.create({
                        data: {
                            sender: payload.sender,
                            groupId: payload.groupId,
                            secretBox: payload.secretBox
                        }
                    });

                    // 2. Ищем всех участников этой группы
                    const group = await prisma.group.findUnique({
                        where: { id: payload.groupId },
                        include: { members: true }
                    });

                    if (group) {
                        // 3. Рассылаем всем онлайн-участникам (кроме самого отправителя)
                        group.members.forEach(member => {
                            if (member.username !== payload.sender) {
                                const memberSocketId = onlineUsers.get(member.username);
                                if (memberSocketId) {
                                    // Отправляем пакет участнику
                                    io.to(memberSocketId).emit('receive_message', { text: JSON.stringify(payload) });
                                }
                            }
                        });
                    }
                } else {
                    // === СТАРАЯ ЛОГИКА ДЛЯ ЛИЧНЫХ ЧАТОВ ===
                    await prisma.message.create({
                        data: {
                            sender: payload.sender,
                            recipient: payload.recipient,
                            secretBox: payload.secretBox
                        }
                    });

                    const recipientSocketId = onlineUsers.get(payload.recipient);
                    if (recipientSocketId) {
                        io.to(recipientSocketId).emit('receive_message', { text: JSON.stringify(payload) });
                    }
                }
            } catch (e) {
                console.error("Ошибка при отправке сообщения:", e);
            }
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