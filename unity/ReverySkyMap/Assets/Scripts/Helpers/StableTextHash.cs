public static class StableTextHash
{
  public static string NormalizeCaseInsensitiveKey(string value)
    => (value ?? string.Empty).Trim().ToUpperInvariant();

  public static float Hash01(string value, int salt)
    => (Hash(value, salt) >> 8) / 16777215f;

  public static int Index(string value, int salt, int count)
  {
    if (count <= 0)
      return 0;

    return (int)(Hash(value, salt) % (uint)count);
  }

  public static uint Hash(string value, int salt)
  {
    unchecked
    {
      uint hash = (2166136261u ^ (uint)salt) * 16777619u;
      string safe = value ?? string.Empty;

      for (int i = 0; i < safe.Length; i++)
        hash = (hash ^ safe[i]) * 16777619u;

      hash ^= (uint)safe.Length * 374761393u;
      hash ^= hash >> 16;
      hash *= 2246822519u;
      hash ^= hash >> 13;
      hash *= 3266489917u;
      hash ^= hash >> 16;

      return hash;
    }
  }
}
