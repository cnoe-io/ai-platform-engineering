from ..agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent, ResponseFormat

def test_komodor_agent_class_exists():
    """Test that KomodorAgent class can be imported"""
    assert KomodorAgent is not None
    assert hasattr(KomodorAgent, '__init__')

def test_response_format_class_exists():
    """Test that ResponseFormat class can be imported and has expected fields"""
    assert ResponseFormat is not None
    # Test that we can create a ResponseFormat instance
    response = ResponseFormat(status="completed", message="test")
    assert response.status == "completed"
    assert response.message == "test"
