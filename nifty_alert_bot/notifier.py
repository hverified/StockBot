from __future__ import annotations

import logging

import requests


logger = logging.getLogger(__name__)


class TelegramNotifier:
    def __init__(self, bot_token: str, chat_id: str) -> None:
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send(self, message: str) -> dict:
        try:
            response = requests.post(
                f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                json={"chat_id": self.chat_id, "text": message},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if not payload.get("ok"):
                raise RuntimeError(f"Telegram API rejected the message: {payload}")
            result = payload.get("result", {})
            logger.info(
                "Telegram delivery confirmed for chat_id=%s message_id=%s",
                self.chat_id,
                result.get("message_id"),
            )
            return result
        except requests.RequestException as exc:
            logger.exception("Telegram send failed")
            raise RuntimeError(f"Telegram alert failed: {exc}") from exc
