import {
  OrbitControls,
  RenderCubeTexture,
  TorusKnot,
  type RenderCubeTextureApi
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { type StoryFn } from '@storybook/react'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useRef, useState, type FC } from 'react'
import { Quaternion, Vector3, type Camera, type Group } from 'three'
import { type OrbitControls as OrbitControlsImpl } from 'three-stdlib'

import {
  Atmosphere,
  Sky,
  type AtmosphereApi
} from '@takram/three-atmosphere/r3f'
import { Dithering, LensFlare } from '@takram/three-effects/r3f'
import {
  Ellipsoid,
  Geodetic,
  radians,
  type GeodeticLike
} from '@takram/three-geospatial'
import { EastNorthUpFrame } from '@takram/three-geospatial/r3f'

import { Stats } from '../helpers/Stats'
import { useControls } from '../helpers/useControls'
import { useLocalDateControls } from '../helpers/useLocalDateControls'
import { useLocationControls } from '../helpers/useLocationControls'
import { useExposureControls } from '../helpers/useExposureControls'

const location = new Geodetic()
const position = new Vector3()
const up = new Vector3()
const offset = new Vector3()
const rotation = new Quaternion()

function applyLocation(
  camera: Camera,
  controls: OrbitControlsImpl,
  { longitude, latitude, height }: GeodeticLike
): void {
  location.set(radians(longitude), radians(latitude), height)
  location.toECEF(position)
  Ellipsoid.WGS84.getSurfaceNormal(position, up)

  rotation.setFromUnitVectors(camera.up, up)
  offset.copy(camera.position).sub(controls.target)
  offset.applyQuaternion(rotation)
  camera.up.copy(up)
  camera.position.copy(position).add(offset)
  controls.target.copy(position)
}

const Scene: FC = () => {
  useExposureControls({ exposure: 10 })
  const { longitude, latitude, height } = useLocationControls()
  const motionDate = useLocalDateControls({
    longitude,
    dayOfYear: 0
  })
  const { osculateEllipsoid, photometric } = useControls('atmosphere', {
    osculateEllipsoid: true,
    photometric: false
  })

  const scene = useThree(({ scene }) => scene)
  const [envMap, setEnvMap] = useState<RenderCubeTextureApi | null>(null)
  useEffect(() => {
    scene.environment = envMap?.fbo.texture ?? null
  }, [scene, envMap])

  const camera = useThree(({ camera }) => camera)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const envMapParentRef = useRef<Group>(null)
  useEffect(() => {
    const controls = controlsRef.current
    if (controls != null) {
      applyLocation(camera, controls, {
        longitude,
        latitude,
        height
      })
      envMapParentRef.current?.position.copy(position)
    }
  }, [longitude, latitude, height, camera])

  const atmosphereRef = useRef<AtmosphereApi>(null)
  useFrame(() => {
    atmosphereRef.current?.updateByDate(new Date(motionDate.get()))
  })

  return (
    <>
      <OrbitControls ref={controlsRef} minDistance={5} />
      <Atmosphere
        ref={atmosphereRef}
        textures='/'
        osculateEllipsoid={osculateEllipsoid}
        photometric={photometric}
      >
        <Sky />
        <group ref={envMapParentRef} position={position}>
          <RenderCubeTexture ref={setEnvMap} resolution={64}>
            <Sky
              // Increase this to avoid flickers. Total radiance doesn't change.
              sunAngularRadius={0.1}
            />
          </RenderCubeTexture>
        </group>
      </Atmosphere>
      <EastNorthUpFrame
        longitude={radians(longitude)}
        latitude={radians(latitude)}
        height={height}
      >
        <TorusKnot args={[1, 0.3, 256, 64]}>
          <meshPhysicalMaterial
            color={[0.4, 0.4, 0.4]}
            metalness={0}
            roughness={1}
            clearcoat={0.5}
            envMap={envMap?.fbo.texture}
          />
        </TorusKnot>
      </EastNorthUpFrame>
      <EffectComposer multisampling={0}>
        <LensFlare />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
        <Dithering />
      </EffectComposer>
    </>
  )
}

const Story: StoryFn = () => (
  <Canvas
    gl={{
      antialias: false,
      depth: false,
      stencil: false
    }}
  >
    <Stats />
    <Scene />
  </Canvas>
)

export default Story
