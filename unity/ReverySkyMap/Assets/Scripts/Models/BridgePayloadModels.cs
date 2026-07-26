using System;

[Serializable]
public class BridgeGraphPayload
{
  public BridgeGraphNote[] notes;
  public BridgeGraphLink[] links;
  public string mapLayout;
}

[Serializable]
public class BridgeGraphNote
{
  public string id;
  public string path;
  public string title;
  public string[] tags;
  public string date;
  public int size;
}

[Serializable]
public class BridgeGraphLink
{
  public string sourceId;
  public string targetId;
  public float weight;
}

[Serializable]
public class BridgeNoteIdentityPayload
{
  public string id;
  public string path;
}

[Serializable]
public class BridgeRuntimeSettingsPayload
{
  public string frameRateMode;
}
