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

/**
 * 兼容旧前端的 /log/stream 端点，只推送 log 类型事件的纯文本行。
 * 待 Plan 3 前端改造完成后可以删除。
 */
eventsRouter.get('/log/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = eventBus.subscribe((e) => {
    if (e.type === 'log') {
      res.write(`data: ${e.line}\n\n`);
    }
  });

  req.on('close', () => unsub());
});
