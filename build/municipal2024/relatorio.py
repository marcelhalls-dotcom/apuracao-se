"""Segunda fonte oficial para a verificação: o Relatório Resultado da Totalização (SISTOT) do TSE, em PDF, por município.

A base atual de votacao_candidato_munzona_2024 (regerada pelo TSE em 07/10/2026) não traz alguns candidatos/municípios
que aparecem na votação por seção. Para esses casos, conferimos os votos com o Anexo IX ("Resultado de votação") do
relatório oficial. Lemos do zip remoto só os PDFs necessários (requisições HTTP Range), sem baixar o zip inteiro.
"""
import io, os, re, subprocess, tempfile, urllib.request, zipfile
from comum import CDN, fold

class RangeFile(io.RawIOBase):
    def __init__(self, url, bloco=1 << 20):
        self.url, self.pos, self.bloco, self.cache = url, 0, bloco, {}
        req = urllib.request.Request(url, method='HEAD')
        self.size = int(urllib.request.urlopen(req, timeout=60).headers['Content-Length'])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off); return self.pos
    def _blk(self, i):
        if i not in self.cache:
            ini = i * self.bloco; fim = min(self.size, ini + self.bloco) - 1
            for tent in range(6):
                try:
                    req = urllib.request.Request(self.url, headers={'Range': f'bytes={ini}-{fim}'})
                    self.cache[i] = urllib.request.urlopen(req, timeout=120).read(); break
                except Exception:
                    if tent == 5: raise
            if len(self.cache) > 64: self.cache.pop(next(iter(self.cache)))
        return self.cache[i]
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos)); out = bytearray()
        while n > 0:
            i, o = divmod(self.pos, self.bloco); b = self._blk(i)[o:o + n]
            out += b; self.pos += len(b); n -= len(b)
            if not b: break
        return bytes(out)
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

LINHA = re.compile(r'^\s*\*?(\d{2,5}) - (.+?)\s{2,}(\d{1,3}(?:[. ]\d{3})+|\d+)\s{2,}(?:[\d,]+%\s+)?(.*?)\s{2,}(\S.*?)\s*$')

CAB = re.compile(r'^\s*\*?(\d{2,5}) - (.+?)\s{5,}(\S.*?)\s*$')
VOTOS = re.compile(r'^\s{20,}(\d{1,3}(?:[. ]\d{3})+|\d+)\s{2,}(?:[\d,]+%\s+)?(\S.*?)\s*$')

def parse_anexo_ix(txt):
    """→ {cargo(11|13): {numero: (votos, destinacao, situacao)}} e o código do município do cabeçalho."""
    cd = None; m = re.search(r'\b(\d{5}) - .+? - [A-Z]{2}\b', txt)
    if m: cd = m.group(1)
    res = {}; dentro = False; cargo = None; pend = None
    # "Votos nulos técnico" do resumo: votos dados a candidatos cujo registro já estava cancelado/indeferido (vão para nulo)
    nt = {}
    for cg, rot in ((11, 'Total de votos - Prefeito'), (13, 'Total de votos - Vereador')):
        i = txt.find(rot)
        if i >= 0:
            m = re.search(r'Votos nulos t[ée]cnico\s+[\d,]+%\s+(\d{1,3}(?:[. ]\d{3})+|\d+)', txt[i:])
            if m: nt[cg] = int(m.group(1).replace('.', '').replace(' ', ''))
    res['nt'] = nt
    for ln in txt.splitlines():
        if 'Anexo' in ln:
            dentro = 'Anexo IX - Resultado de votação' in ln; continue
        if not dentro: continue
        if ln.startswith('Cargo:'):
            cargo = 11 if 'Prefeito' in ln else (13 if 'Vereador' in ln else None); continue
        mm = LINHA.match(ln)
        if mm and cargo:
            res.setdefault(cargo, {})[int(mm.group(1))] = (int(mm.group(3).replace('.', '').replace(' ', '')), mm.group(4).strip(), mm.group(5).strip())
            pend = None; continue
        # nome longo: o pdftotext põe a situação na linha do nome e os votos na linha de baixo
        m2 = CAB.match(ln)
        if m2 and cargo:
            pend = (int(m2.group(1)), m2.group(3).strip()); continue
        m3 = VOTOS.match(ln)
        if m3 and cargo and pend:
            res.setdefault(cargo, {})[pend[0]] = (int(m3.group(1).replace('.', '').replace(' ', '')), m3.group(2).strip(), pend[1]); pend = None
    return cd, res

def relatorios(UF, pedidos, workers=8):
    """pedidos: {(cd, nm, turno)} → {(cd, turno): {cargo: {nr: (votos, dest, sit)}, 'nt': {cargo: nulos técnicos}}}"""
    import threading
    from concurrent.futures import ThreadPoolExecutor
    url = f'{CDN}/relatorio_resultado_totalizacao/Relatorio_Resultado_Totalizacao_2024_{UF}.zip'
    nomes = zipfile.ZipFile(RangeFile(url)).namelist()
    porfold = {}
    for n in nomes:
        m = re.match(r'^(\d+)_([A-Z]{2})_(.+)_2024_T(\d)\.pdf$', n)
        if m: porfold[(fold(m.group(3)), int(m.group(4)))] = n
    loc = threading.local()
    def um(item):
        cd, nm, t = item
        n = porfold.get((fold(nm), t))
        if not n: return (cd, t), None
        if not hasattr(loc, 'z'): loc.z = zipfile.ZipFile(RangeFile(url))
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, 'r.pdf'); open(p, 'wb').write(loc.z.read(n))
            txt = subprocess.run(['pdftotext', '-layout', p, '-'], capture_output=True, text=True).stdout
        cdpdf, res = parse_anexo_ix(txt)
        return (cd, t), (res if (cdpdf in (None, cd)) else None)
    with ThreadPoolExecutor(workers) as ex:
        return dict(ex.map(um, sorted(pedidos)))
