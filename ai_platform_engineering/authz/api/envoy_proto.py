"""Minimal wire-compatible Envoy ext_authz v3 protobuf classes."""

from __future__ import annotations

from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

_OPTIONAL = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
_REPEATED = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
_STRING = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
_MESSAGE = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE


def _field(
    message: descriptor_pb2.DescriptorProto,
    name: str,
    number: int,
    field_type: int,
    *,
    type_name: str = "",
    label: int = _OPTIONAL,
) -> None:
    value = message.field.add()
    value.name = name
    value.number = number
    value.label = label
    value.type = field_type
    if type_name:
        value.type_name = type_name


def _map(
    parent: descriptor_pb2.DescriptorProto,
    *,
    entry_name: str,
    field_name: str,
    field_number: int,
    value_type: int,
    value_type_name: str = "",
    parent_type_name: str,
) -> None:
    entry = parent.nested_type.add()
    entry.name = entry_name
    entry.options.map_entry = True
    _field(entry, "key", 1, _STRING)
    _field(entry, "value", 2, value_type, type_name=value_type_name)
    _field(
        parent,
        field_name,
        field_number,
        _MESSAGE,
        type_name=f"{parent_type_name}.{entry_name}",
        label=_REPEATED,
    )


def _build() -> dict[str, type]:
    proto = descriptor_pb2.FileDescriptorProto(
        name="envoy/service/auth/v3/caipe_external_auth.proto",
        package="envoy.service.auth.v3",
        syntax="proto3",
    )
    request = proto.message_type.add()
    request.name = "CheckRequest"
    _field(request, "attributes", 1, _MESSAGE, type_name=".envoy.service.auth.v3.AttributeContext")

    attributes = proto.message_type.add()
    attributes.name = "AttributeContext"
    request_context = attributes.nested_type.add()
    request_context.name = "Request"
    _field(
        request_context,
        "http",
        2,
        _MESSAGE,
        type_name=".envoy.service.auth.v3.AttributeContext.HttpRequest",
    )
    http = attributes.nested_type.add()
    http.name = "HttpRequest"
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
        _field(http, name, number, _STRING)
    _field(http, "size", 9, descriptor_pb2.FieldDescriptorProto.TYPE_INT64)
    _field(http, "raw_body", 12, descriptor_pb2.FieldDescriptorProto.TYPE_BYTES)
    _map(
        http,
        entry_name="HeadersEntry",
        field_name="headers",
        field_number=3,
        value_type=_STRING,
        parent_type_name=".envoy.service.auth.v3.AttributeContext.HttpRequest",
    )
    _field(
        attributes,
        "request",
        4,
        _MESSAGE,
        type_name=".envoy.service.auth.v3.AttributeContext.Request",
    )
    _field(
        attributes,
        "metadata_context",
        11,
        _MESSAGE,
        type_name=".envoy.service.auth.v3.Metadata",
    )

    value = proto.message_type.add()
    value.name = "Value"
    _field(value, "string_value", 3, _STRING)
    _field(value, "struct_value", 5, _MESSAGE, type_name=".envoy.service.auth.v3.Struct")
    struct = proto.message_type.add()
    struct.name = "Struct"
    _map(
        struct,
        entry_name="FieldsEntry",
        field_name="fields",
        field_number=1,
        value_type=_MESSAGE,
        value_type_name=".envoy.service.auth.v3.Value",
        parent_type_name=".envoy.service.auth.v3.Struct",
    )
    metadata = proto.message_type.add()
    metadata.name = "Metadata"
    _map(
        metadata,
        entry_name="FilterMetadataEntry",
        field_name="filter_metadata",
        field_number=1,
        value_type=_MESSAGE,
        value_type_name=".envoy.service.auth.v3.Struct",
        parent_type_name=".envoy.service.auth.v3.Metadata",
    )

    status = proto.message_type.add()
    status.name = "Status"
    _field(status, "code", 1, descriptor_pb2.FieldDescriptorProto.TYPE_INT32)
    _field(status, "message", 2, _STRING)
    ok = proto.message_type.add()
    ok.name = "OkHttpResponse"
    denied = proto.message_type.add()
    denied.name = "DeniedHttpResponse"
    _field(denied, "body", 3, _STRING)
    response = proto.message_type.add()
    response.name = "CheckResponse"
    _field(response, "status", 1, _MESSAGE, type_name=".envoy.service.auth.v3.Status")
    _field(
        response,
        "denied_response",
        2,
        _MESSAGE,
        type_name=".envoy.service.auth.v3.DeniedHttpResponse",
    )
    _field(
        response,
        "ok_response",
        3,
        _MESSAGE,
        type_name=".envoy.service.auth.v3.OkHttpResponse",
    )
    pool = descriptor_pool.DescriptorPool()
    pool.Add(proto)
    return {
        name: message_factory.GetMessageClass(
            pool.FindMessageTypeByName(f"envoy.service.auth.v3.{name}")
        )
        for name in ("CheckRequest", "CheckResponse")
    }


_CLASSES = _build()
CheckRequest = _CLASSES["CheckRequest"]
CheckResponse = _CLASSES["CheckResponse"]


def response(*, allowed: bool, code: int, message: str = ""):
    value = CheckResponse()
    value.status.code = code
    value.status.message = message
    if allowed:
        value.ok_response.SetInParent()
    else:
        value.denied_response.body = message
    return value
