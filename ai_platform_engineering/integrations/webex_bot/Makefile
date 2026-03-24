.PHONY: test test-integration lint lint-fix

test:
	cd ../../.. && python -m pytest ai_platform_engineering/integrations/webex_bot/tests/ -v -m "not integration"

test-integration:
	cd ../../.. && python -m pytest ai_platform_engineering/integrations/webex_bot/tests/ -v -m integration

lint:
	cd ../../.. && ruff check ai_platform_engineering/integrations/webex_bot/

lint-fix:
	cd ../../.. && ruff check --fix ai_platform_engineering/integrations/webex_bot/
