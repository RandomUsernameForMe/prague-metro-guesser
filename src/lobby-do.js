import { newCode } from '../web/shared/code.mjs';

const TTL_MS = 60000; // starší čekající se zahodí — nejspíš zavřel kartu

export class LobbyDO {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch() {
    const now = Date.now();
    const waiting = await this.ctx.storage.get('waiting');
    if (waiting && now - waiting.at < TTL_MS) {
      await this.ctx.storage.delete('waiting');
      return Response.json({ code: waiting.code, host: false });
    }
    // nikdo nečeká → založ kód, otevři si zápas a čekej v něm
    const code = newCode();
    await this.ctx.storage.put('waiting', { code, at: now });
    return Response.json({ code, host: true });
  }
}
