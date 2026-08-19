# -*- coding: utf-8 -*-
"""QQ C2C bridge: a botpy client that relays QQ messages to DSH over NDJSON.

stdout is reserved strictly for the NDJSON event stream (one JSON object per
line); all logging goes to stderr. stdin carries DSH -> QQ send instructions.
Credentials and the shared media directory arrive via environment variables set
by the DSH plugin (QQBOT_APPID, QQBOT_SECRET, QQBOT_MEDIA_DIR).
"""

import asyncio
import json
import logging
import os
import sys

import botpy
from botpy.message import C2CMessage

MEDIA_DIR = os.environ.get("QQBOT_MEDIA_DIR", "")


def configure_logging() -> None:
    """Route every logger to stderr so stdout stays a clean NDJSON stream."""
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    for name in ("botpy", "websockets", "aiohttp", "urllib3"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(logging.WARNING)


def send_event(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


async def download_attachment(url: str, dest_dir: str, filename: str) -> str:
    """Download one QQ attachment URL to the shared media directory."""
    import aiohttp  # deferred import keeps the module import light

    os.makedirs(dest_dir, exist_ok=True)
    safe = os.path.basename(filename or "attachment")
    out = os.path.join(dest_dir, "%s-%s" % (os.getpid(), safe))
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            resp.raise_for_status()
            data = await resp.read()
    with open(out, "wb") as fh:
        fh.write(data)
    return out


class BridgeClient(botpy.Client):
    async def on_ready(self):
        send_event({"type": "ready"})
        logging.getLogger("qq-bot").info("bridge ready")
        asyncio.get_running_loop().create_task(self._read_stdin())

    async def on_c2c_message_create(self, message: C2CMessage):
        await self._handle_message(message)

    async def _handle_message(self, message: C2CMessage) -> None:
        try:
            openid = message.author.user_openid
            attachments = []
            for att in (message.attachments or []):
                content_type = getattr(att, "content_type", None) or ""
                url = getattr(att, "url", None)
                if not url:
                    continue
                filename = getattr(att, "filename", None) or "attachment"
                try:
                    local = await download_attachment(url, MEDIA_DIR, filename)
                except Exception as exc:  # noqa: BLE001
                    logging.getLogger("qq-bot").warning("download attachment failed: %s", exc)
                    continue
                attachments.append({
                    "kind": "image" if content_type.startswith("image/") else "file",
                    "contentType": content_type,
                    "filename": getattr(att, "filename", None),
                    "path": local,
                })
            send_event({
                "type": "message",
                "scene": "c2c",
                "peerId": openid,
                "msgId": getattr(message, "id", None),
                "content": (getattr(message, "content", None) or "").strip(),
                "attachments": attachments,
            })
        except Exception as exc:  # noqa: BLE001
            logging.getLogger("qq-bot").exception("handle message failed")
            send_event({"type": "error", "message": str(exc)})

    async def _read_stdin(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if line == "":
                return
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception as exc:  # noqa: BLE001
                send_event({"type": "error", "message": "bad json: %s" % exc})
                continue
            try:
                await self._dispatch(msg)
            except Exception as exc:  # noqa: BLE001
                logging.getLogger("qq-bot").exception("dispatch failed")
                send_event({"type": "error", "message": str(exc)})

    async def _dispatch(self, msg: dict) -> None:
        if msg.get("type") == "send":
            await self._send(msg)

    async def _send(self, msg: dict) -> None:
        openid = msg["peerId"]
        payload = msg.get("payload") or {}
        kind = msg.get("kind", "markdown")
        reply_to = msg.get("replyTo")
        if kind in ("markdown", "text"):
            text = payload.get("text") or ""
            if kind == "markdown":
                await self.api.post_c2c_message(
                    openid=openid, msg_type=2,
                    markdown={"content": text}, msg_id=reply_to,
                )
            else:
                await self.api.post_c2c_message(
                    openid=openid, msg_type=0, content=text, msg_id=reply_to,
                )
        elif kind == "image":
            await self._send_image(openid, payload)
        elif kind == "file":
            await self._send_file(openid, payload)

    async def _send_image(self, openid: str, payload: dict) -> None:
        # post_c2c_file requires a publicly reachable URL; when DSH only has a
        # local path we fall back to a text note naming it.
        url = payload.get("url")
        if url:
            media = await self.api.post_c2c_file(openid=openid, file_type=1, url=url)
            await self.api.post_c2c_message(openid=openid, msg_type=7, media=media)
            return
        await self.api.post_c2c_message(
            openid=openid, msg_type=2,
            markdown={"content": "🖼️ 图片已生成：`%s`" % payload.get("path", "")},
        )

    async def _send_file(self, openid: str, payload: dict) -> None:
        # 文件(file_type=4) 在 QQ 开放平台暂未开放，回退为文本提示。
        path = payload.get("path") or ""
        filename = payload.get("filename") or os.path.basename(path) or "file"
        await self.api.post_c2c_message(
            openid=openid, msg_type=2,
            markdown={"content": "📄 文件已生成：`%s`（路径 `%s`）" % (filename, path)},
        )


def main() -> None:
    # Windows 下子进程 stdio 默认用系统代码页（GBK/cp936），而 Node 侧按 UTF-8 读写，
    # 双向中文都会乱码。强制 stdio 走 UTF-8（bridge.ts 侧也已设 PYTHONUTF8=1 兜底）。
    for _stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 -- 非可重配置流的兜底
            pass

    configure_logging()
    appid = os.environ.get("QQBOT_APPID", "")
    secret = os.environ.get("QQBOT_SECRET", "")
    if not appid or not secret:
        send_event({"type": "error", "message": "QQBOT_APPID/QQBOT_SECRET not set"})
        sys.exit(2)

    # botpy 1.2.x 在 Client.__init__ 里调用已废弃的 asyncio.get_event_loop()，
    # Python 3.10+ 没有预先绑定的 loop 时会抛 RuntimeError。先创建并绑定一个 loop。
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        intents = botpy.Intents(public_messages=True)
        client = BridgeClient(intents=intents)
        client.run(appid=appid, secret=secret)
    finally:
        try:
            loop.close()
        except Exception:  # noqa: BLE001 -- loop may already be closed on exit
            pass


if __name__ == "__main__":
    main()
