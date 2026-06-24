Shader "ReverySky/Skybox Cubemap Virtual FOV"
{
    Properties
    {
        _Tint ("Tint Color", Color) = (.5, .5, .5, .5)
        [Gamma] _Exposure ("Exposure", Range(0, 8)) = 1.0
        _Rotation ("Rotation", Range(0, 360)) = 0
        [NoScaleOffset] _Tex ("Cubemap (HDR)", Cube) = "grey" {}
        _SkyboxFovScale ("Skybox FOV Scale", Range(0.5, 3.0)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "Queue" = "Background"
            "RenderType" = "Background"
            "PreviewType" = "Skybox"
        }

        Cull Off
        ZWrite Off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 2.0

            #include "UnityCG.cginc"

            samplerCUBE _Tex;
            half4 _Tex_HDR;

            half4 _Tint;
            half _Exposure;
            float _Rotation;
            float _SkyboxFovScale;

            struct appdata
            {
                float4 vertex : POSITION;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 dir : TEXCOORD0;
            };

            float3 RotateAroundYInDegrees(float3 dir, float degrees)
            {
                float radians = degrees * UNITY_PI / 180.0;
                float s = sin(radians);
                float c = cos(radians);

                float3x3 rotationMatrix = float3x3(
                    c, 0, -s,
                    0, 1, 0,
                    s, 0, c
                );

                return mul(rotationMatrix, dir);
            }

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.dir = v.vertex.xyz;
                return o;
            }

            half4 frag(v2f i) : SV_Target
            {
                float3 dir = normalize(i.dir);

                // Scale the visible sky direction without changing the real camera FOV.
                // 1.0 = original Skybox/Cubemap look.
                // >1.0 = wider/farther skybox look.
                dir.xy *= _SkyboxFovScale;
                dir = normalize(dir);

                dir = RotateAroundYInDegrees(dir, _Rotation);

                half4 tex = texCUBE(_Tex, dir);
                half3 color = DecodeHDR(tex, _Tex_HDR);

                color *= _Tint.rgb * unity_ColorSpaceDouble.rgb;
                color *= _Exposure;

                return half4(color, 1);
            }
            ENDCG
        }
    }

    Fallback Off
}