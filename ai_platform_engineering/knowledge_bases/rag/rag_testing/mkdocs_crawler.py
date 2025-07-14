import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import os
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('crawler.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

BASE_URL = "https://platform-docs.outshift.io/"
VISITED = set()

def fetch_page(url):
    logger.info(f"Fetching: {url}")
    try:
        resp = requests.get(url)
        resp.raise_for_status()
        logger.info(f"Successfully fetched: {url} (status: {resp.status_code})")
        return BeautifulSoup(resp.text, "html.parser")
    except requests.RequestException as e:
        logger.error(f"Failed to fetch {url}: {e}")
        raise

def extract_nav_links(soup):
    logger.debug("Extracting navigation links from page")
    nav = soup.select_one("nav.md-nav")
    if not nav:
        logger.warning("No navigation found on page")
        return []
    links = [a['href'] for a in nav.select("a[href]")]
    full_links = [urljoin(BASE_URL, href) for href in links if not href.startswith("http")]
    logger.info(f"Found {len(full_links)} navigation links")
    return full_links

def extract_main_text(soup):
    logger.debug("Extracting main text content from page")
    main = soup.select_one("main.md-main div.md-content")
    if main:
        content = main.get_text(separator="\n", strip=True)
        logger.info(f"Extracted {len(content)} characters of content")
        return content
    else:
        logger.warning("No main content found on page")
        return ""

def sanitize_filename(url):
    logger.debug(f"Sanitizing filename for URL: {url}")
    parsed = urlparse(url)
    path = parsed.path.strip("/").replace("/", "_")
    filename = path if path else "index"
    logger.debug(f"Sanitized filename: {filename}")
    return filename

def save_to_file(url, content):
    filename = sanitize_filename(url) + ".txt"
    filepath = os.path.join("outshift_docs", filename)
    logger.info(f"Saving content to: {filepath}")
    
    try:
        os.makedirs("outshift_docs", exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        logger.info(f"Successfully saved {len(content)} characters to {filepath}")
    except IOError as e:
        logger.error(f"Failed to save file {filepath}: {e}")
        raise

def crawl_site(start_url):
    logger.info(f"Starting crawl from: {start_url}")
    soup = fetch_page(start_url)
    nav_links = extract_nav_links(soup)
    
    logger.info(f"Total pages to crawl: {len(nav_links)}")
    successful_crawls = 0
    failed_crawls = 0

    for i, link in enumerate(nav_links, 1):
        if link in VISITED:
            logger.debug(f"Skipping already visited link: {link}")
            continue
            
        logger.info(f"Processing page {i}/{len(nav_links)}: {link}")
        VISITED.add(link)
        
        try:
            page_soup = fetch_page(link)
            content = extract_main_text(page_soup)
            save_to_file(link, content)
            successful_crawls += 1
            logger.info(f"Successfully processed: {link}")
        except Exception as e:
            failed_crawls += 1
            logger.error(f"Failed to process {link}: {e}")
    
    logger.info(f"Crawling completed. Successful: {successful_crawls}, Failed: {failed_crawls}")

# Start crawling
if __name__ == "__main__":
    logger.info("Starting mkdocs crawler")
    crawl_site(BASE_URL)
    logger.info("Crawler finished")
