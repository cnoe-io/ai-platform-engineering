import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import os

BASE_URL = "https://platform-docs.outshift.io/"
VISITED = set()

def fetch_page(url):
    print(f"Fetching: {url}")
    resp = requests.get(url)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")

def extract_nav_links(soup):
    nav = soup.select_one("nav.md-nav")
    if not nav:
        return []
    links = [a['href'] for a in nav.select("a[href]")]
    return [urljoin(BASE_URL, href) for href in links if not href.startswith("http")]

def extract_main_text(soup):
    main = soup.select_one("main.md-main div.md-content")
    return main.get_text(separator="\n", strip=True) if main else ""

def sanitize_filename(url):
    parsed = urlparse(url)
    path = parsed.path.strip("/").replace("/", "_")
    return path if path else "index"

def save_to_file(url, content):
    filename = sanitize_filename(url) + ".txt"
    os.makedirs("outshift_docs", exist_ok=True)
    with open(os.path.join("outshift_docs", filename), "w", encoding="utf-8") as f:
        f.write(content)

def crawl_site(start_url):
    soup = fetch_page(start_url)
    nav_links = extract_nav_links(soup)

    for link in nav_links:
        if link in VISITED:
            continue
        VISITED.add(link)
        try:
            page_soup = fetch_page(link)
            content = extract_main_text(page_soup)
            save_to_file(link, content)
        except Exception as e:
            print(f"Failed to fetch {link}: {e}")

# Start crawling
crawl_site(BASE_URL)
