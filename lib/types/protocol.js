/**
 * NDJSON wire protocol between the qq-bot plugin and its Python botpy
 * subprocess. One JSON object per line; stdout carries QQ → DSH events, stdin
 * carries DSH → QQ send instructions. Media payloads reference local filesystem
 * paths (Python downloads QQ attachments before forwarding; DSH writes outbound
 * images to the shared media directory), never inline bytes.
 * @module @deepseek-ai/dsh-qq-bot/protocol
 */
/** Incremental NDJSON line framer: turns raw stream chunks into complete lines. */
export class LineDecoder {
    buffer = '';
    push(chunk) {
        this.buffer += chunk;
        const lines = [];
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (line.trim() !== '')
                lines.push(line);
            newline = this.buffer.indexOf('\n');
        }
        return lines;
    }
}
/** Encode one outbound object as a single NDJSON line. */
export function encode(event) {
    return `${JSON.stringify(event)}\n`;
}
//# sourceMappingURL=protocol.js.map