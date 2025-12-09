from bs4 import BeautifulSoup

def scrape_docsaurus(soup: BeautifulSoup) -> str:
    article_tag = soup.find('article')
    if article_tag:
        content = article_tag.get_text(separator='\n', strip=True)
    else:
        content = soup.get_text(separator='\n', strip=True)
    return content