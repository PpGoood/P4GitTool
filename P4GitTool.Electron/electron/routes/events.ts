import { Router } from 'express';
import { eventBus } from '../services/eventBus';

export const eventsRouter = Router();

/**
 * SSE 统一事件流：日志、文件变化、操作完成等。
 * 事件格式：{"type":"log","line":"..."} 等
 */
eventsRouter.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 首次连接推送一个 ready 心跳
  res.write(`: connected\n\n`);

  const unsub = eventBus.subscribe((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  // 周期性心跳防止代理断开（每 25 秒）
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});
