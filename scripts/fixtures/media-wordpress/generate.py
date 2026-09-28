"""Generate disposable, rights-owned media. Requires existing ffmpeg on PATH."""
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=False)

def png(name, color):
    width, height = 480, 240
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b''.join(b'\0' + bytes(color) * width for _ in range(height))
    (out / name).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

for language, color in [('de', (190, 65, 40)), ('en', (35, 100, 190)), ('en-v2', (35, 145, 85)), ('unmapped', (105, 105, 105))]:
    png(language + '.png', color)
for language in ['de', 'en']:
    stream = f'BT /F1 24 Tf 50 100 Td (Deepglot neutral media fixture {language.upper()}) Tj ET'.encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    data, offsets = b'%PDF-1.4\n', [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:]) + f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    (out / (language + '.pdf')).write_bytes(data)
    with zipfile.ZipFile(out / (language + '.docx'), 'w') as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Deepglot neutral fixture {language.upper()}</w:t></w:r></w:p></w:body></w:document>')
    for extension, codec in [('mp4', 'libx264'), ('webm', 'libvpx-vp9')]:
        color = '#be4128' if language == 'de' else '#2364be'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c={color}:s=320x180:d=1', '-an', '-c:v', codec, '-pix_fmt', 'yuv420p', str(out / (language + '.' + extension))], check=True)
