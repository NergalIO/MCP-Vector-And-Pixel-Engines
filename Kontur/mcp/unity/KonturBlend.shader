// Kontur → Unity: режимы наложения слоёв (multiply, screen, overlay…) для спрайтов.
// Работает в URP (2D Renderer) и встроенном конвейере, в цветовом пространстве Linear и Gamma.
// Цвет считается без освещения, как в Kontur. Смешивание — блендингом видеокарты (без копии экрана):
// точно — multiply, screen; overlay, soft-light, hard-light — удвоенным умножением (верно для тёмного фона);
// plus-lighter, darken, lighten, color-dodge, difference — приблизительно.
// В Linear-проекте Unity смешивает в линейных значениях, Kontur (как браузер) — в sRGB; цвет слоя
// пересчитывается так, чтобы умножение и overlay совпадали с Kontur, а screen — точнее обычных слоёв Unity.
Shader "Kontur/Sprite Blend"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 6
        [Enum(UnityEngine.Rendering.BlendOp)] _BlendOp ("Blend Op", Float) = 0
        // как готовить цвет слоя: 0 — умножить на альфу (lighten, difference), 1 — множитель (multiply, darken),
        // 2 — удвоенный множитель (overlay, soft-light, hard-light), 3 — осветление (color-dodge),
        // 4 — добавка света (screen, сложение): (альфа × цвет sRGB)^_Curve в Linear-проекте
        _Prep ("Color Prep", Float) = 0
        _Curve ("Linear Curve", Float) = 1.6
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" "PreviewType"="Plane" "CanUseSpriteAtlas"="True" }
        Cull Off
        Lighting Off
        ZWrite Off
        BlendOp [_BlendOp]
        Blend [_SrcBlend] [_DstBlend]

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };

            sampler2D _MainTex;
            float4 _Color;
            float _Prep;
            float _Curve;

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                o.color = v.color * _Color;
                return o;
            }

            // значения смешивания ↔ sRGB, в котором считает Kontur (в Gamma-проекте — без пересчёта)
            float3 ToSRGB(float3 c)
            {
            #ifdef UNITY_COLORSPACE_GAMMA
                return c;
            #else
                return LinearToGammaSpace(c);
            #endif
            }
            float3 FromSRGB(float3 c)
            {
            #ifdef UNITY_COLORSPACE_GAMMA
                return c;
            #else
                return GammaToLinearSpace(max(c, 0));
            #endif
            }

            float4 frag (v2f i) : SV_Target
            {
                float4 c = tex2D(_MainTex, i.uv) * i.color;
                if (_Prep < 0.5) return float4(c.rgb * c.a, c.a);
                float3 s = ToSRGB(c.rgb);
                // добавка света: в Linear подобрана степень, при которой screen совпадает с Kontur на любом фоне
                // (средняя ошибка ~5 из 255 — меньше, чем у обычной полупрозрачности Unity в Linear)
                if (_Prep > 3.5)
                {
                #ifdef UNITY_COLORSPACE_GAMMA
                    return float4(s * c.a, c.a);
                #else
                    return float4(pow(max(s * c.a, 0), _Curve), c.a);
                #endif
                }
                // фон × множитель
                if (_Prep < 1.5) return float4(FromSRGB(lerp(float3(1, 1, 1), s, c.a)), c.a);
                // фон × 2 × множитель (до двух раз ярче)
                if (_Prep < 2.5) return float4(min(1, FromSRGB(2 * lerp(float3(0.5, 0.5, 0.5), s, c.a)) * 0.5), c.a);
                // фон × (1 + множитель): осветление
                float3 k = lerp(float3(1, 1, 1), 1 / max(1 - s, 1e-3), c.a);
                return float4(min(1, FromSRGB(k) - 1), c.a);
            }
            ENDCG
        }
    }
}
