import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging

import aiofiles.os
import openai
from fsspec import AbstractFileSystem

from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document

logger = logging.getLogger(__name__)


class AudioReader(BaseReader):
    """Video audio parser.

    Extract text from transcript of video/audio files.

    """

    supported_files = [
        "flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "oga", "wav", "webm"
    ]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Init parser."""
        super().__init__(*args, **kwargs)
        self._client = openai.AsyncOpenAI()

    async def aload_data(
            self,
            path: Path,
            extra_info: Optional[Dict] = None,
            fs: Optional[AbstractFileSystem] = None,
    ) -> List[Document]:
        extension = path.name.split('.')[-1]
        if extension not in self.supported_files:
            logger.warning(f'Unsupported file type: {extension}')
            return []

        proc = await asyncio.create_subprocess_shell(
            f'sh pipelines/base/split_media.sh {str(path)} 20971520 "-hide_banner -loglevel error"',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)

        stdout, stderr = await proc.communicate()

        chunks: List[str] = []
        if stdout:
            data = stdout.decode()
            chunks = [chunk for chunk in data.split('\n') if len(chunk.strip())]

        if stderr:
            logger.error(f'[stderr] {stderr.decode()}')

        if not len(chunks):
            return []

        result = ''
        for chunk in chunks:
            response = await self._client.audio.transcriptions.create(
                file=Path(chunk), model='whisper-1', response_format='json'
            )
            result += '\n' + response.text

            await aiofiles.os.unlink(chunk)

        if not result:
            return []

        response = await self._client.chat.completions.create(messages=[
            {
                "role": "system",
                "content": 'Your task is to correct any spelling discrepancies in the transcribed text. Only add '
                           'necessary punctuation such as periods, commas, and capitalization, and use only the '
                           'context provided."'
            },
            {
                "role": "user",
                "content": result
            }
        ], model='gpt-4o-mini', temperature=0)

        return [Document(text=response.choices[0].message.content, metadata=extra_info or {})]
