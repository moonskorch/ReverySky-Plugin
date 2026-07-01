using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;

public class NodeLabelCullingForeignTextEditModeTests
{
  [TestCase("Заметка о звездах")]
  [TestCase("中文节点")]
  public void HiddenLabelRoot_HidesForeignTextAndFallbackChildren(string labelText)
  {
    GameObject nodeObject = new GameObject("NodeLabelCullingForeignTextNode");
    GameObject labelRoot = new GameObject("ForeignTextRoot");
    GameObject textObject = new GameObject("ForeignText");
    GameObject fallbackRendererObject = new GameObject("FallbackSubmeshProbe");

    try
    {
      labelRoot.transform.SetParent(nodeObject.transform, false);
      textObject.transform.SetParent(labelRoot.transform, false);
      fallbackRendererObject.transform.SetParent(textObject.transform, false);
      fallbackRendererObject.AddComponent<MeshRenderer>();

      TextMeshPro text = textObject.AddComponent<TextMeshPro>();
      text.text = labelText;

      NodeLabelCullingTarget target = nodeObject.AddComponent<NodeLabelCullingTarget>();
      SetPrivateField(target, "labelRoot", labelRoot);

      target.SetDistanceVisible(nodeObject.transform, false);

      Assert.That(labelRoot.activeSelf, Is.False);
      Assert.That(textObject.activeInHierarchy, Is.False);
      Assert.That(fallbackRendererObject.activeInHierarchy, Is.False);
    }
    finally
    {
      Object.DestroyImmediate(fallbackRendererObject);
      Object.DestroyImmediate(textObject);
      Object.DestroyImmediate(labelRoot);
      Object.DestroyImmediate(nodeObject);
    }
  }

  [Test]
  public void DistanceManager_AppliesVisibilityOnlyWhenStateChanges()
  {
    GameObject managerObject = new GameObject("NodeDistanceCullingTransitionManager");
    GameObject nodeObject = new GameObject("NodeDistanceCullingTransitionNode");

    try
    {
      NodeDistanceCullingManager manager = managerObject.AddComponent<NodeDistanceCullingManager>();
      var consumer = new CountingDistanceConsumer();
      int index = manager.Register(nodeObject.transform, nodeObject.transform, consumer, 1f, 1f);

      InvokeApplyVisibilityIfChanged(manager, index, true);
      InvokeApplyVisibilityIfChanged(manager, index, true);
      InvokeApplyVisibilityIfChanged(manager, index, false);

      Assert.That(consumer.CallCount, Is.EqualTo(2));
      Assert.That(consumer.LastVisible, Is.False);
      Assert.That(consumer.LastNode, Is.SameAs(nodeObject.transform));
    }
    finally
    {
      Object.DestroyImmediate(nodeObject);
      Object.DestroyImmediate(managerObject);
    }
  }

  private static void InvokeApplyVisibilityIfChanged(NodeDistanceCullingManager manager, int index, bool visible)
  {
    MethodInfo method = typeof(NodeDistanceCullingManager).GetMethod(
      "ApplyVisibilityIfChanged",
      BindingFlags.Instance | BindingFlags.NonPublic);

    Assert.That(method, Is.Not.Null, "NodeDistanceCullingManager.ApplyVisibilityIfChanged was not found.");
    method.Invoke(manager, new object[] { index, visible });
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"{target.GetType().Name}.{fieldName} was not found.");
    field.SetValue(target, value);
  }

  private sealed class CountingDistanceConsumer : INodeDistanceVisibilityConsumer
  {
    public int CallCount { get; private set; }
    public bool LastVisible { get; private set; }

    public Component LastNode { get; private set; }

    public void SetDistanceVisible(Component node, bool visible)
    {
      CallCount++;
      LastNode = node;
      LastVisible = visible;
    }
  }
}
