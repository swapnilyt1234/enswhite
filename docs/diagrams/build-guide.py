"""Build the offline diagram presentation and ZIP after rendering the Mermaid sources."""
from pathlib import Path
import base64
import html
import re
import xml.etree.ElementTree as ET
import zipfile

docs = Path(__file__).resolve().parents[1]
source = (docs / 'project-flow.md').read_text(encoding='utf-8')
sections = re.findall(r'^## ([1-7]\. [^\n]+)\n(.*?)(?=^## |\Z)', source, re.M | re.S)
assert len(sections) == 7, 'Expected seven diagram walkthroughs'
cards, navigation = [], []
for index, (title, body) in enumerate(sections, 1):
    image = re.search(r'!\[([^]]+)\]\((diagrams/[^)]+\.svg)\)', body)
    quote = re.search(r'\*\*Say:\*\* “([^”]+)”', body)
    assert image and quote, f'Missing diagram or speaker note: {title}'
    path = docs / image[2]
    raw = path.read_bytes()
    root = ET.fromstring(raw)
    assert root.tag.endswith('svg') and not root.findall('.//{http://www.w3.org/2000/svg}foreignObject'), 'Use portable SVG text labels'
    width = float(root.attrib['viewBox'].split()[2])
    data = base64.b64encode(raw).decode('ascii')
    navigation.append(f'<a href="#diagram-{index}">{html.escape(title)}</a>')
    cards.append(f'''<section id="diagram-{index}"><p class="eyebrow">ENSWHITE / DIAGRAM {index:02}</p>
<h2>{html.escape(title)}</h2><p class="speaker">“{html.escape(quote[1])}”</p>
<input class="zoom" type="checkbox" id="zoom-{index}"><label for="zoom-{index}">Full-size, scrollable view</label>
<figure style="--native-width:{width}px"><img alt="{html.escape(image[1])}" src="data:image/svg+xml;base64,{data}"></figure>
<p class="links"><a href="{image[2]}">SVG</a> · <a href="{image[2][:-4]}.png">PNG</a> · <a href="{image[2][:-4]}.mmd">Editable Mermaid</a></p></section>''')

story = re.search(r'## A 60-second walkthrough\n\n“([^”]+)”', source)[1]
page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EnsWhite — Project flow and architecture</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f7ef;color:#173c2d;font:17px/1.6 Arial,sans-serif}header,main,footer{max-width:1440px;margin:auto;padding:40px 6vw}header{padding-bottom:24px}h1{font-size:clamp(32px,5vw,60px);line-height:1.1;letter-spacing:-2px;margin:10px 0 22px}h2{font-size:30px;line-height:1.2;margin:0 0 18px}p{max-width:1000px}a{color:#195740;text-underline-offset:4px}.eyebrow{font-size:12px;letter-spacing:2px;font-weight:bold}.intro{font-size:21px;max-width:940px}.disclosure{background:#e7eee0;padding:18px 24px;border-radius:12px;max-width:none}.nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding-top:15px}.nav a{font-size:14px}section{scroll-margin-top:20px;margin:0 0 48px;padding:30px;background:white;border-radius:16px;border:1px solid #d7dfd4;box-shadow:0 4px 20px #183c2b06}.speaker{font-size:19px;margin-bottom:22px}.zoom{accent-color:#195740}.zoom+label{font-size:13px;padding-left:5px;cursor:pointer}figure{margin:20px 0;overflow:auto;border-top:1px solid #e6ebe2;padding:22px 4px}figure img{display:block;width:var(--native-width);max-width:100%;height:auto;margin:auto}.zoom:checked~figure img{max-width:none}.links{font-size:13px}footer{padding-top:0;font-size:14px}.story{padding:25px;background:#e8f0df;border-radius:12px}.legend{display:flex;flex-wrap:wrap;gap:20px;font-size:14px}.swatch{display:inline-block;width:12px;height:12px;margin-right:7px;border-radius:3px}.blue{background:#cbdcf5}.green{background:#cce3d0}.amber{background:#f4dfad}@media(max-width:700px){header,main,footer{padding:24px 16px}section{padding:18px}h2{font-size:25px}.speaker{font-size:17px}}@media print{body{background:white;font-size:12px}header,main,footer{max-width:none;padding:10px}.nav,.zoom,.zoom+label,.links{display:none}section{break-before:page;border:0;box-shadow:none;padding:0;margin:0}figure{overflow:visible}figure img,.zoom:checked~figure img{max-width:100%;max-height:220mm;object-fit:contain}.speaker{font-size:15px}a{color:inherit}}
</style></head><body><header><p class="eyebrow">ENSWHITE / A DIAGRAM-FIRST WALKTHROUGH</p><h1>Give AI employees an identity.<br>A budget. A verifiable receipt.</h1>
<p class="intro">ENSv2 is the company directory and HR system. Whitechain is the bank. EnsWhite coordinates the work and connects the two through signed policy attestations.</p>
<p class="disclosure"><strong>Demo boundary:</strong> Razorpay fiat is simulated. Test USDT transfers on Whitechain are real testnet transactions. INR 500 → 5 test USDT is a fixed demo allocation, not a currency conversion.</p>
<div class="legend"><span><i class="swatch blue"></i>ENS identity and permissions</span><span><i class="swatch green"></i>Whitechain balances and settlement</span><span><i class="swatch amber"></i>Constraints and recovery</span></div>
<nav class="nav" aria-label="Diagram navigation">''' + ''.join(navigation) + '''</nav></header><main>''' + ''.join(cards) + '''<div class="story"><h2>Your 60-second explanation</h2><p>''' + html.escape(story) + '''</p></div></main>
<footer><p><strong>Trust and scope:</strong> The backend holds encrypted custodial wallets; its attester is a trusted bridge for Razorpay and ENS facts. Already-signed policies can remain valid for up to 60 seconds after firing, never beyond expiry. Vendor-registry emancipation does not remove ancestor-pointer control. Company signup creates the ENS namespace; new bank setup stays manual. Wildcard contractors, aliasing and agent subteams are deferred.</p><p>The HTML embeds all seven diagrams and works offline. Use the full-size toggle for dense charts, or open the companion SVG/PNG. Full written flow: <a href="project-flow.md">project-flow.md</a>. Public evidence: <a href="deployments/enswhite-testnets.json">transaction manifest</a>. Source: <a href="https://github.com/swapnilyt1234/enswhite">github.com/swapnilyt1234/enswhite</a>.</p></footer></body></html>'''
(docs / 'project-flow.html').write_text(page, encoding='utf-8')
with zipfile.ZipFile(docs / 'enswhite-diagrams.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    paths = [docs/'project-flow.html', docs/'project-flow.md', docs/'architecture.md', docs/'deployments/enswhite-testnets.json']
    paths += [p for p in (docs/'diagrams').iterdir() if p.suffix in {'.mmd', '.svg', '.png', '.py', '.json', '.md'}]
    for path in sorted(paths):
        archive.write(path, path.relative_to(docs))
print('Built offline HTML and ZIP with seven checked SVG diagrams.')
