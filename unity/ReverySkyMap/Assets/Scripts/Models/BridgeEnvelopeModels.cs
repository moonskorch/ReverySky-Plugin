using System;

[Serializable]
public class BridgeGraphSetEnvelope
{
  public string protocolVersion;
  public string type;
  public string requestId;
  public BridgeGraphPayload payload;
}

[Serializable]
public class BridgeNoteFocusEnvelope
{
  public string protocolVersion;
  public string type;
  public BridgeNoteIdentityPayload payload;
}

[Serializable]
public class BridgeRuntimeSettingsEnvelope
{
  public string protocolVersion;
  public string type;
  public BridgeRuntimeSettingsPayload payload;
}
