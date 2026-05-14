import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INIT_IDP = REPO_ROOT / "deploy" / "keycloak" / "init-idp.sh"
REALM_CONFIG = REPO_ROOT / "deploy" / "keycloak" / "realm-config.json"
CHART_REALM_CONFIG = (
    REPO_ROOT / "charts" / "ai-platform-engineering" / "charts" / "keycloak" / "realm-config.json"
)


def test_init_idp_emits_imported_idp_groups_to_caipe_ui() -> None:
    script = INIT_IDP.read_text()

    assert "idp-groups-to-groups" in script
    assert '"syncMode": "FORCE"' in script
    assert '"user.attribute":"idp_groups"' in script
    assert '"claim.name":"groups"' in script
    assert '"multivalued":"true"' in script
    assert '"userinfo.token.claim":"true"' in script
    assert '"id.token.claim":"true"' in script
    assert '"access.token.claim":"false"' in script


def _assert_caipe_ui_groups_mapper(path: Path) -> None:
    realm = json.loads(path.read_text())
    caipe_ui = next(client for client in realm["clients"] if client["clientId"] == "caipe-ui")
    mapper = next(
        protocol_mapper
        for protocol_mapper in caipe_ui["protocolMappers"]
        if protocol_mapper["name"] == "idp-groups-to-groups"
    )

    assert mapper["protocolMapper"] == "oidc-usermodel-attribute-mapper"
    assert mapper["config"]["user.attribute"] == "idp_groups"
    assert mapper["config"]["claim.name"] == "groups"
    assert mapper["config"]["multivalued"] == "true"
    assert mapper["config"]["userinfo.token.claim"] == "true"
    assert mapper["config"]["id.token.claim"] == "true"
    assert mapper["config"]["access.token.claim"] == "false"


def test_realm_config_has_caipe_ui_groups_mapper() -> None:
    _assert_caipe_ui_groups_mapper(REALM_CONFIG)
    _assert_caipe_ui_groups_mapper(CHART_REALM_CONFIG)
