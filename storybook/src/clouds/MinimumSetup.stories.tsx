import { Canvas } from '@react-three/fiber'
import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { type Meta, type StoryFn } from '@storybook/react'
import { ToneMappingMode } from 'postprocessing'
import { type FC } from 'react'

import { AerialPerspective, Atmosphere } from '@takram/three-atmosphere/r3f'
import { Clouds } from '@takram/three-clouds/r3f'
import { LensFlare } from '@takram/three-geospatial-effects/r3f'

export default {
  title: 'clouds (WIP)/Minimum Setup',
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta

const Scene: FC = () => (
  <Atmosphere date={new Date('2025-01-01T07:00:00Z')}>
    <EffectComposer multisampling={0} enableNormalPass>
      <Clouds />
      <AerialPerspective sky sunIrradiance skyIrradiance />
      <LensFlare />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  </Atmosphere>
)

export const MinimumSetup: StoryFn = () => (
  <Canvas
    gl={{
      antialias: false,
      depth: false,
      stencil: false,
      toneMappingExposure: 10
    }}
    camera={{
      near: 1,
      far: 4e5,
      // See the basic story for deriving ECEF coordinates and rotation.
      position: [4529893.894855564, 2615333.425024031, 3638042.815326614],
      rotation: [0.6423512931563148, -0.2928348796035058, -0.8344824769956042]
    }}
  >
    <Scene />
  </Canvas>
)
