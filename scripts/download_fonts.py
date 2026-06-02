"""Download self-hosted Google Fonts at Docker build time."""
import urllib.request, re, os, sys

FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist", "fonts")
os.makedirs(FONTS_DIR, exist_ok=True)

CSS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=Inter:wght@300;400;500;600;700"
    "&family=JetBrains+Mono:wght@300;400;500;600"
    "&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800"
    "&display=swap"
)

req = urllib.request.Request(CSS_URL, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
css = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

count = 0
for match in re.finditer(r"url\(([^)]+)\)", css):
    font_url = match.group(1)
    fname = font_url.split("/")[-1].split("?")[0]
    dst = os.path.join(FONTS_DIR, fname)
    if not os.path.exists(dst):
        urllib.request.urlretrieve(font_url, dst)
    count += 1

print(f"Downloaded {count} font files to {FONTS_DIR}")
