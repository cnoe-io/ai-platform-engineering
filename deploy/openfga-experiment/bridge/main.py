"""gRPC ext_authz target for AgentGateway that calls OpenFGA Check.

The server implements the Envoy external authorization service method
`envoy.service.auth.v3.Authorization/Check` with a minimal protobuf schema
that is wire-compatible for the fields this bridge needs.
"""

from __future__ import annotations

import os
import signal
import sys
from concurrent import futures

import grpc
import httpx
import jwt
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

OPENFGA_HTTP = os.environ.get("OPENFGA_HTTP", "http://openfga:8080").rstrip("/")
OPENFGA_STORE_NAME = os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga").strip()
GRPC_BIND = os.environ.get("EXT_AUTHZ_GRPC_BIND", "0.0.0.0:9100")
# Optional explicit store id (skips discovery)
STORE_ID: str = os.environ.get("OPENFGA_STORE_ID", "").strip()
# Optional: if set, only these subs get 200 without calling OpenFGA (escape hatch)
BYPASS_SUBS = frozenset(
    s.strip() for s in os.environ.get("OPENFGA_BYPASS_SUBS", "").split(",") if s.strip()
)
OK = 0
PERMISSION_DENIED = 7
UNAUTHENTICATED = 16
UNAVAILABLE = 14


def _build_proto_classes() -> dict[str, type]:
    """Build minimal Envoy ext_authz message classes at runtime."""
    file_proto = descriptor_pb2.FileDescriptorProto()
    file_proto.name = "envoy/service/auth/v3/minimal_external_auth.proto"
    file_proto.package = "envoy.service.auth.v3"
    file_proto.syntax = "proto3"

    check_request = file_proto.message_type.add()
    check_request.name = "CheckRequest"
    field = check_request.field.add()
    field.name = "attributes"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.AttributeContext"

    attribute_context = file_proto.message_type.add()
    attribute_context.name = "AttributeContext"

    request_msg = attribute_context.nested_type.add()
    request_msg.name = "Request"
    field = request_msg.field.add()
    field.name = "http"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.AttributeContext.HttpRequest"

    http_request = attribute_context.nested_type.add()
    http_request.name = "HttpRequest"
    for name, number in (
        ("id", 1),
        ("method", 2),
        ("path", 4),
        ("host", 5),
        ("scheme", 6),
        ("query", 7),
        ("fragment", 8),
        ("protocol", 10),
        ("body", 11),
    ):
        field = http_request.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = http_request.field.add()
    field.name = "size"
    field.number = 9
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT64
    field = http_request.field.add()
    field.name = "raw_body"
    field.number = 12
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_BYTES
    headers_entry = http_request.nested_type.add()
    headers_entry.name = "HeadersEntry"
    headers_entry.options.map_entry = True
    field = headers_entry.field.add()
    field.name = "key"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = headers_entry.field.add()
    field.name = "value"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = http_request.field.add()
    field.name = "headers"
    field.number = 3
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.AttributeContext.HttpRequest.HeadersEntry"

    field = attribute_context.field.add()
    field.name = "request"
    field.number = 4
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.AttributeContext.Request"
    field = attribute_context.field.add()
    field.name = "metadata_context"
    field.number = 11
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Metadata"

    value_msg = file_proto.message_type.add()
    value_msg.name = "Value"
    field = value_msg.field.add()
    field.name = "string_value"
    field.number = 3
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = value_msg.field.add()
    field.name = "struct_value"
    field.number = 5
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Struct"

    struct_msg = file_proto.message_type.add()
    struct_msg.name = "Struct"
    fields_entry = struct_msg.nested_type.add()
    fields_entry.name = "FieldsEntry"
    fields_entry.options.map_entry = True
    field = fields_entry.field.add()
    field.name = "key"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = fields_entry.field.add()
    field.name = "value"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Value"
    field = struct_msg.field.add()
    field.name = "fields"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Struct.FieldsEntry"

    metadata_msg = file_proto.message_type.add()
    metadata_msg.name = "Metadata"
    filter_entry = metadata_msg.nested_type.add()
    filter_entry.name = "FilterMetadataEntry"
    filter_entry.options.map_entry = True
    field = filter_entry.field.add()
    field.name = "key"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = filter_entry.field.add()
    field.name = "value"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Struct"
    field = metadata_msg.field.add()
    field.name = "filter_metadata"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".envoy.service.auth.v3.Metadata.FilterMetadataEntry"

    status_msg = file_proto.message_type.add()
    status_msg.name = "Status"
    field = status_msg.field.add()
    field.name = "code"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT32
    field = status_msg.field.add()
    field.name = "message"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING

    file_proto.message_type.add().name = "OkHttpResponse"
    denied = file_proto.message_type.add()
    denied.name = "DeniedHttpResponse"
    field = denied.field.add()
    field.name = "body"
    field.number = 3
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING

    check_response = file_proto.message_type.add()
    check_response.name = "CheckResponse"
    for name, number, type_name in (
        ("status", 1, ".envoy.service.auth.v3.Status"),
        ("denied_response", 2, ".envoy.service.auth.v3.DeniedHttpResponse"),
        ("ok_response", 3, ".envoy.service.auth.v3.OkHttpResponse"),
    ):
        field = check_response.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
        field.type_name = type_name

    pool = descriptor_pool.DescriptorPool()
    pool.Add(file_proto)
    names = [
        "CheckRequest",
        "CheckResponse",
        "AttributeContext",
        "Status",
        "OkHttpResponse",
        "DeniedHttpResponse",
        "Metadata",
        "Struct",
        "Value",
    ]
    return {
        name: message_factory.GetMessageClass(
            pool.FindMessageTypeByName(f"envoy.service.auth.v3.{name}")
        )
        for name in names
    }


PROTO = _build_proto_classes()
CheckRequest = PROTO["CheckRequest"]
CheckResponse = PROTO["CheckResponse"]


def discover_store_id() -> str:
    """Return the configured OpenFGA store id, discovering it by name if needed."""
    global STORE_ID
    if STORE_ID:
        return STORE_ID
    with httpx.Client(timeout=15.0) as client:
        r = client.get(f"{OPENFGA_HTTP}/stores")
        r.raise_for_status()
        for s in r.json().get("stores", []):
            if s.get("name") == OPENFGA_STORE_NAME:
                STORE_ID = s["id"]
                print(f"[bridge] discovered store id={STORE_ID}", file=sys.stderr)
                break
    if not STORE_ID:
        print(
            f"[bridge] No store named {OPENFGA_STORE_NAME!r} — all checks will deny",
            file=sys.stderr,
        )
    return STORE_ID


def _check_openfga(user: str, relation: str, obj: str) -> bool:
    store_id = discover_store_id()
    if not store_id:
        return False
    url = f"{OPENFGA_HTTP}/stores/{store_id}/check"
    body: dict = {
        "tuple_key": {"user": user, "relation": relation, "object": obj},
    }
    with httpx.Client(timeout=10.0) as client:
        r = client.post(url, json=body)
        r.raise_for_status()
        return bool(r.json().get("allowed"))


def _decode_bearer_subject(auth_header: str) -> str | None:
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None


def _headers_from_check_request(request: CheckRequest) -> dict[str, str]:
    headers = request.attributes.request.http.headers
    return {str(k).lower(): str(v) for k, v in headers.items()}


def _string_value(value: object) -> str | None:
    text = getattr(value, "string_value", "")
    return text if isinstance(text, str) and text else None


def _subject_from_metadata(request: CheckRequest) -> str | None:
    metadata = request.attributes.metadata_context.filter_metadata
    for key in ("caipe.auth", "dev.agentgateway.jwt"):
        if key not in metadata:
            continue
        fields = metadata[key].fields
        if "sub" in fields:
            sub = _string_value(fields["sub"])
            if sub:
                return sub
        if "claims" in fields:
            claim_fields = fields["claims"].struct_value.fields
            if "sub" in claim_fields:
                sub = _string_value(claim_fields["sub"])
                if sub:
                    return sub
    return None


def subject_from_check_request(request: CheckRequest) -> str | None:
    metadata_subject = _subject_from_metadata(request)
    if metadata_subject:
        return metadata_subject

    headers = _headers_from_check_request(request)
    agw_subject = headers.get("x-authenticated-sub")
    if agw_subject:
        return agw_subject

    return _decode_bearer_subject(headers.get("authorization", ""))


def build_check_request(
    *,
    headers: dict[str, str],
    path: str = "/",
    method: str = "GET",
    metadata_subject: str | None = None,
) -> CheckRequest:
    """Build a CheckRequest for unit tests and local diagnostics."""
    request = CheckRequest()
    request.attributes.request.http.method = method
    request.attributes.request.http.path = path
    request.attributes.request.http.headers.update({k.lower(): v for k, v in headers.items()})
    if metadata_subject:
        request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
            "sub"
        ].string_value = metadata_subject
    return request


def build_check_response(
    *,
    allowed: bool,
    code: int | None = None,
    message: str | None = None,
) -> CheckResponse:
    response = CheckResponse()
    if allowed:
        response.status.code = OK
        response.ok_response.SetInParent()
        return response

    response.status.code = code if code is not None else PERMISSION_DENIED
    response.status.message = message or "denied by OpenFGA"
    response.denied_response.body = response.status.message
    return response


class OpenFgaAuthorizationService:
    """Envoy Authorization.Check service backed by OpenFGA."""

    def Check(self, request: CheckRequest, context: grpc.ServicerContext) -> CheckResponse:
        sub = subject_from_check_request(request)
        if not sub:
            header_names = sorted(_headers_from_check_request(request).keys())
            print(
                f"[bridge] missing subject on ext_authz request; headers={header_names}",
                file=sys.stderr,
            )
            return build_check_response(
                allowed=False,
                code=UNAUTHENTICATED,
                message="missing authenticated subject",
            )

        if sub in BYPASS_SUBS:
            return build_check_response(allowed=True)

        user = f"user:{sub}"
        relation = os.environ.get("OPENFGA_RELATION", "can_call")
        obj = os.environ.get("OPENFGA_OBJECT", "document:mcp")
        try:
            allowed = _check_openfga(user, relation, obj)
        except Exception as e:
            print(f"[bridge] OpenFGA check error: {e}", file=sys.stderr)
            return build_check_response(
                allowed=False,
                code=UNAVAILABLE,
                message="OpenFGA check error",
            )

        return build_check_response(allowed=allowed)


def _add_authorization_service(server: grpc.Server) -> None:
    handler = grpc.unary_unary_rpc_method_handler(
        OpenFgaAuthorizationService().Check,
        request_deserializer=CheckRequest.FromString,
        response_serializer=lambda response: response.SerializeToString(),
    )
    generic_handler = grpc.method_handlers_generic_handler(
        "envoy.service.auth.v3.Authorization",
        {"Check": handler},
    )
    server.add_generic_rpc_handlers((generic_handler,))


def serve() -> None:
    discover_store_id()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    _add_authorization_service(server)
    server.add_insecure_port(GRPC_BIND)
    server.start()
    print(f"[bridge] gRPC ext_authz listening on {GRPC_BIND}", file=sys.stderr)

    should_stop = futures.Future()

    def stop(signum: int, _frame: object) -> None:
        print(f"[bridge] received signal {signum}; stopping", file=sys.stderr)
        server.stop(grace=5)
        should_stop.set_result(None)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    should_stop.result()


if __name__ == "__main__":
    serve()
