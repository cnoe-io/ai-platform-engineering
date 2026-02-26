FROM python:3.13-slim-trixie

WORKDIR /app

COPY ai_platform_engineering/integrations/slack_bot/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_platform_engineering/integrations/slack_bot/ /app/

CMD ["python", "-m", "app"]
