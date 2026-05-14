import socket

import pytest

from common.utils import sanitize_url


def _patch_dns(monkeypatch, records: dict[str, list[str]]) -> None:
  def fake_getaddrinfo(hostname, port, *args, **kwargs):
    return [
      (
        socket.AF_INET6 if ":" in ip else socket.AF_INET,
        socket.SOCK_STREAM,
        6,
        "",
        (ip, port or 0),
      )
      for ip in records[hostname]
    ]

  monkeypatch.setattr("common.utils.socket.getaddrinfo", fake_getaddrinfo)


def test_sanitize_url_allows_global_addresses(monkeypatch):
  _patch_dns(monkeypatch, {"docs.example.com": ["93.184.216.34"]})

  assert sanitize_url("docs.example.com/guide") == "https://docs.example.com/guide"


@pytest.mark.parametrize(
  "resolved_ip",
  [
    "169.254.169.254",
    "100.64.0.1",
    "fc00::1",
    "::",
  ],
)
def test_sanitize_url_rejects_non_global_resolved_addresses(monkeypatch, resolved_ip):
  _patch_dns(monkeypatch, {"metadata.example.com": [resolved_ip]})

  with pytest.raises(ValueError, match="publicly routable"):
    sanitize_url("https://metadata.example.com/latest/meta-data")


def test_sanitize_url_rejects_mixed_global_and_private_dns_answers(monkeypatch):
  _patch_dns(monkeypatch, {"docs.example.com": ["93.184.216.34", "10.1.2.3"]})

  with pytest.raises(ValueError, match="publicly routable"):
    sanitize_url("https://docs.example.com")
