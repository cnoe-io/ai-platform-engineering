# Istio Configuration

When running in an Istio service mesh, you need to configure port exclusions to allow direct communication between certain components that need to bypass mTLS.

## Configuration

Add the following `podAnnotations` to your values file for components that need Istio port exclusions:

### Supervisor Agent

```yaml
supervisor-agent:
  podAnnotations:
    traffic.sidecar.istio.io/excludeInboundPorts: "15020"
    traffic.sidecar.istio.io/excludeOutboundPorts: "8098,8099,9446,19530,2379,2380,7687,7474,6379"
```

### RAG Stack Components

```yaml
rag-stack:
  rag-server:
    podAnnotations:
      traffic.sidecar.istio.io/excludeInboundPorts: "9446,9091,15020"
      traffic.sidecar.istio.io/excludeOutboundPorts: "19530,2379,2380,9091,53100,21123,21124,22222,9000,7687,7474,6379,8098,8099,8000"

  agent-rag:
    podAnnotations:
      traffic.sidecar.istio.io/excludeInboundPorts: "8099,15020"
      traffic.sidecar.istio.io/excludeOutboundPorts: "19530,2379,2380,9091,53100,21123,21124,22222,9000,7687,7474,6379,9446"

  agent-ontology:
    podAnnotations:
      traffic.sidecar.istio.io/excludeInboundPorts: "8098,15020"
      traffic.sidecar.istio.io/excludeOutboundPorts: "19530,2379,2380,9091,53100,21123,21124,22222,9000,7687,7474,6379"

  rag-redis:
    podAnnotations:
      traffic.sidecar.istio.io/excludeInboundPorts: "6379,15020"

  rag-webui:
    podAnnotations:
      traffic.sidecar.istio.io/excludeOutboundPorts: "9446"
```

### Milvus Components

```yaml
  milvus:
    mixCoordinator:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "53100,9091,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "53100,21123,21124,22222,19530,2379,2380,9091,9000"

    proxy:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "19530,19529,9091,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "53100,21123,21124,22222,19530,2379,2380,9091,9000"

    dataNode:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "21124,9091,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "53100,21123,21124,22222,19530,2379,2380,9091,9000"

    queryNode:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "21123,9091,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "53100,21123,21124,22222,19530,2379,2380,9091,9000"

    etcd:
      podAnnotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "2379,2380,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "2379,2380,15020"

    minio:
      podAnnotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "9000,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "9000"
```

### Neo4j

```yaml
  neo4j:
    podSpec:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "7687,7474,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "7687,7474"

  neo4j-ontology:
    podSpec:
      annotations:
        traffic.sidecar.istio.io/excludeInboundPorts: "7687,7474,15020"
        traffic.sidecar.istio.io/excludeOutboundPorts: "7687,7474"
```

## Manual Patch Required

**Note:** The Milvus `streamingNode` component does NOT support component-specific annotations in the Milvus Helm chart. After deployment, you must manually patch it:

```bash
kubectl patch deployment caipe-milvus-streamingnode -n <namespace> --type=merge -p='{"spec":{"template":{"metadata":{"annotations":{"traffic.sidecar.istio.io/excludeInboundPorts":"22222,21123,9091,15020","traffic.sidecar.istio.io/excludeOutboundPorts":"53100,21123,21124,22222,19530,2379,2380,9091,9000"}}}}}'
```

## Port Reference

- **15020**: Istio sidecar metrics/health port
- **6379**: Redis
- **7474**: Neo4j HTTP
- **7687**: Neo4j Bolt
- **8098**: Agent Ontology
- **8099**: Agent RAG
- **9000**: MinIO
- **9091**: Milvus metrics
- **9446**: RAG Server
- **2379, 2380**: etcd client and peer ports
- **19530**: Milvus proxy
- **21123**: Milvus query node
- **21124**: Milvus data node
- **22222**: Milvus streaming node
- **53100**: Milvus mix coordinator
