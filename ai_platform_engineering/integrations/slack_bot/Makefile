.PHONY: test test-integration lint lint-fix

test:
	cd ../../.. && python -m pytest ai_platform_engineering/integrations/slack_bot/tests/ -v -m "not integration" --ignore=ai_platform_engineering/integrations/slack_bot/tests/test_langfuse_feedback.py

test-integration:
	cd ../../.. && python -m pytest ai_platform_engineering/integrations/slack_bot/tests/ -v -m integration

lint:
	cd ../../.. && ruff check ai_platform_engineering/integrations/slack_bot/

lint-fix:
	cd ../../.. && ruff check --fix ai_platform_engineering/integrations/slack_bot/
