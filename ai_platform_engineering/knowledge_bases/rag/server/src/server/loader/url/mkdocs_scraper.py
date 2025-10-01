from bs4 import BeautifulSoup

def scrape_mkdocs(soup: BeautifulSoup) -> str:
    main_content = soup.select_one("main.md-main div.md-content")
    if main_content:
        content = main_content.get_text(separator='\n', strip=True)
    else:
        content = soup.get_text(separator='\n', strip=True)
    return content