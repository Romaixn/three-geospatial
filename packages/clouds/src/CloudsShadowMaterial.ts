/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import {
  GLSL3,
  Matrix4,
  RawShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  type Camera,
  type Data3DTexture,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Texture
} from 'three'

import {
  AtmosphereParameters,
  correctAtmosphereAltitude
} from '@takram/three-atmosphere'
import {
  assertType,
  Ellipsoid,
  resolveIncludes
} from '@takram/three-geospatial'
import {
  depth,
  math,
  raySphereIntersection
} from '@takram/three-geospatial/shaders'

import { STBN_TEXTURE_DEPTH, STBN_TEXTURE_SIZE } from './constants'
import {
  createCloudLayerUniforms,
  createCloudParameterUniforms,
  type CloudLayerUniforms,
  type CloudParameterUniforms
} from './uniforms'

import clouds from './shaders/clouds.glsl?raw'
import fragmentShader from './shaders/cloudsShadow.frag?raw'
import vertexShader from './shaders/cloudsShadow.vert?raw'
import parameters from './shaders/parameters.glsl?raw'
import structuredSampling from './shaders/structuredSampling.glsl?raw'

declare module 'three' {
  interface Camera {
    isPerspectiveCamera?: boolean
  }
}

const vectorScratch = /*#__PURE__*/ new Vector3()

export interface CloudsShadowMaterialParameters {
  sunDirectionRef?: Vector3
  localWeatherTexture?: Texture | null
  shapeTexture?: Texture | null
  shapeDetailTexture?: Texture | null
}

interface CloudsShadowMaterialUniforms
  extends CloudLayerUniforms,
    CloudParameterUniforms {
  [key: string]: Uniform<unknown>
  depthBuffer: Uniform<Texture | null>
  projectionMatrix: Uniform<Matrix4> // The main camera
  viewMatrix: Uniform<Matrix4> // The main camera
  inverseProjectionMatrix: Uniform<Matrix4> // The main camera
  inverseShadowMatrices: Uniform<Matrix4[]> // Inverse view projection of the sun
  resolution: Uniform<Vector2>
  cameraNear: Uniform<number>
  cameraFar: Uniform<number>
  frame: Uniform<number>
  blueNoiseTexture: Uniform<Data3DTexture | null>

  // Atmospheric parameters
  bottomRadius: Uniform<number> // TODO
  ellipsoidCenter: Uniform<Vector3>
  sunDirection: Uniform<Vector3>

  // Raymarch to clouds
  maxIterations: Uniform<number>
  minStepSize: Uniform<number>
  maxStepSize: Uniform<number>
  minDensity: Uniform<number>
  minTransmittance: Uniform<number>
}

export interface CloudsShadowMaterial {
  uniforms: CloudsShadowMaterialUniforms
}

export class CloudsShadowMaterial extends RawShaderMaterial {
  protected readonly atmosphere: AtmosphereParameters
  ellipsoid: Ellipsoid
  correctAltitude: boolean

  constructor(
    {
      sunDirectionRef,
      localWeatherTexture = null,
      shapeTexture = null,
      shapeDetailTexture = null
    }: CloudsShadowMaterialParameters = {},
    atmosphere = AtmosphereParameters.DEFAULT
  ) {
    super({
      name: 'CloudsShadowMaterial',
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader: resolveIncludes(fragmentShader, {
        core: {
          depth,
          math,
          raySphereIntersection
        },
        parameters,
        structuredSampling,
        clouds
      }),
      uniforms: {
        depthBuffer: new Uniform(null),
        projectionMatrix: new Uniform(new Matrix4()),
        viewMatrix: new Uniform(new Matrix4()),
        inverseProjectionMatrix: new Uniform(new Matrix4()),
        inverseShadowMatrices: new Uniform(
          Array.from({ length: 4 }, () => new Matrix4()) // Populate the max number of elements
        ),
        resolution: new Uniform(new Vector2()),
        cameraNear: new Uniform(0),
        cameraFar: new Uniform(0),
        frame: new Uniform(0),
        blueNoiseTexture: new Uniform(null),

        ...createCloudParameterUniforms({
          localWeatherTexture,
          shapeTexture,
          shapeDetailTexture
        }),
        ...createCloudLayerUniforms(),

        // Atmospheric parameters
        bottomRadius: new Uniform(atmosphere.bottomRadius), // TODO
        ellipsoidCenter: new Uniform(new Vector3()),
        sunDirection: new Uniform(sunDirectionRef ?? new Vector3()),

        // Raymarch to clouds
        maxIterations: new Uniform(100),
        minStepSize: new Uniform(50),
        maxStepSize: new Uniform(1000),
        minDensity: new Uniform(1e-5),
        minTransmittance: new Uniform(1e-2)
      } satisfies CloudsShadowMaterialUniforms,
      defines: {
        DEPTH_PACKING: '0',
        USE_SHAPE_DETAIL: '1',
        STBN_TEXTURE_SIZE: `${STBN_TEXTURE_SIZE}`,
        STBN_TEXTURE_DEPTH: `${STBN_TEXTURE_DEPTH}`
      }
    })

    this.atmosphere = atmosphere
    this.ellipsoid = Ellipsoid.WGS84
    this.correctAltitude = true
    this.cascadeCount = 4
  }

  copyCameraSettings(camera: Camera): void {
    const uniforms = this.uniforms
    if (camera.isPerspectiveCamera === true) {
      if (this.defines.PERSPECTIVE_CAMERA !== '1') {
        this.defines.PERSPECTIVE_CAMERA = '1'
        this.needsUpdate = true
      }
    } else {
      if (this.defines.PERSPECTIVE_CAMERA != null) {
        delete this.defines.PERSPECTIVE_CAMERA
        this.needsUpdate = true
      }
    }

    const projectionMatrix = uniforms.projectionMatrix
    const viewMatrix = uniforms.viewMatrix
    const inverseProjectionMatrix = uniforms.inverseProjectionMatrix
    projectionMatrix.value.copy(camera.projectionMatrix)
    viewMatrix.value.copy(camera.matrixWorldInverse)
    inverseProjectionMatrix.value.copy(camera.projectionMatrixInverse)

    assertType<PerspectiveCamera | OrthographicCamera>(camera)
    uniforms.cameraNear.value = camera.near
    uniforms.cameraFar.value = camera.far

    const position = camera.getWorldPosition(vectorScratch)
    correctAtmosphereAltitude(
      this,
      position,
      this.atmosphere.bottomRadius,
      uniforms.ellipsoidCenter.value
    )
  }

  setSize(width: number, height: number): void {
    this.uniforms.resolution.value.set(width, height)
  }

  get depthBuffer(): Texture | null {
    return this.uniforms.depthBuffer.value
  }

  set depthBuffer(value: Texture | null) {
    this.uniforms.depthBuffer.value = value
  }

  get depthPacking(): number {
    return +this.defines.DEPTH_PACKING
  }

  set depthPacking(value: number) {
    if (value !== this.depthPacking) {
      this.defines.DEPTH_PACKING = `${value}`
      this.needsUpdate = true
    }
  }

  get cascadeCount(): number {
    return +this.defines.CASCADE_COUNT
  }

  set cascadeCount(value: number) {
    if (value !== this.cascadeCount) {
      this.defines.CASCADE_COUNT = `${value}`
      this.needsUpdate = true
    }
  }

  get useShapeDetail(): boolean {
    return this.defines.USE_SHAPE_DETAIL != null
  }

  set useShapeDetail(value: boolean) {
    if (value !== this.useShapeDetail) {
      if (value) {
        this.defines.USE_SHAPE_DETAIL = '1'
      } else {
        delete this.defines.USE_SHAPE_DETAIL
      }
      this.needsUpdate = true
    }
  }
}
