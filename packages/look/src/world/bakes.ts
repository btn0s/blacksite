import cast512Color from '../../assets/surfaces/cast/512/color.ktx2?url'
import cast512Normal from '../../assets/surfaces/cast/512/normal.ktx2?url'
import cast512Orm from '../../assets/surfaces/cast/512/orm.ktx2?url'
import cast512Masks from '../../assets/surfaces/cast/512/masks.ktx2?url'
import panel512Color from '../../assets/surfaces/panel/512/color.ktx2?url'
import panel512Normal from '../../assets/surfaces/panel/512/normal.ktx2?url'
import panel512Orm from '../../assets/surfaces/panel/512/orm.ktx2?url'
import panel512Masks from '../../assets/surfaces/panel/512/masks.ktx2?url'
import slab512Color from '../../assets/surfaces/slab/512/color.ktx2?url'
import slab512Normal from '../../assets/surfaces/slab/512/normal.ktx2?url'
import slab512Orm from '../../assets/surfaces/slab/512/orm.ktx2?url'
import slab512Masks from '../../assets/surfaces/slab/512/masks.ktx2?url'
import stained512Color from '../../assets/surfaces/stained/512/color.ktx2?url'
import stained512Normal from '../../assets/surfaces/stained/512/normal.ktx2?url'
import stained512Orm from '../../assets/surfaces/stained/512/orm.ktx2?url'
import stained512Masks from '../../assets/surfaces/stained/512/masks.ktx2?url'
import paint512Color from '../../assets/surfaces/paint/512/color.ktx2?url'
import paint512Normal from '../../assets/surfaces/paint/512/normal.ktx2?url'
import paint512Orm from '../../assets/surfaces/paint/512/orm.ktx2?url'
import paint512Masks from '../../assets/surfaces/paint/512/masks.ktx2?url'
import brick512Color from '../../assets/surfaces/brick/512/color.ktx2?url'
import brick512Normal from '../../assets/surfaces/brick/512/normal.ktx2?url'
import brick512Orm from '../../assets/surfaces/brick/512/orm.ktx2?url'
import brick512Masks from '../../assets/surfaces/brick/512/masks.ktx2?url'
import rust512Color from '../../assets/surfaces/rust/512/color.ktx2?url'
import rust512Normal from '../../assets/surfaces/rust/512/normal.ktx2?url'
import rust512Orm from '../../assets/surfaces/rust/512/orm.ktx2?url'
import rust512Masks from '../../assets/surfaces/rust/512/masks.ktx2?url'
import metal512Color from '../../assets/surfaces/metal/512/color.ktx2?url'
import metal512Normal from '../../assets/surfaces/metal/512/normal.ktx2?url'
import metal512Orm from '../../assets/surfaces/metal/512/orm.ktx2?url'
import metal512Masks from '../../assets/surfaces/metal/512/masks.ktx2?url'
import corrugated512Color from '../../assets/surfaces/corrugated/512/color.ktx2?url'
import corrugated512Normal from '../../assets/surfaces/corrugated/512/normal.ktx2?url'
import corrugated512Orm from '../../assets/surfaces/corrugated/512/orm.ktx2?url'
import corrugated512Masks from '../../assets/surfaces/corrugated/512/masks.ktx2?url'
import asphalt512Color from '../../assets/surfaces/asphalt/512/color.ktx2?url'
import asphalt512Normal from '../../assets/surfaces/asphalt/512/normal.ktx2?url'
import asphalt512Orm from '../../assets/surfaces/asphalt/512/orm.ktx2?url'
import asphalt512Masks from '../../assets/surfaces/asphalt/512/masks.ktx2?url'
import dirt512Color from '../../assets/surfaces/dirt/512/color.ktx2?url'
import dirt512Normal from '../../assets/surfaces/dirt/512/normal.ktx2?url'
import dirt512Orm from '../../assets/surfaces/dirt/512/orm.ktx2?url'
import dirt512Masks from '../../assets/surfaces/dirt/512/masks.ktx2?url'
import grass512Color from '../../assets/surfaces/grass/512/color.ktx2?url'
import grass512Normal from '../../assets/surfaces/grass/512/normal.ktx2?url'
import grass512Orm from '../../assets/surfaces/grass/512/orm.ktx2?url'
import grass512Masks from '../../assets/surfaces/grass/512/masks.ktx2?url'
import gravel512Color from '../../assets/surfaces/gravel/512/color.ktx2?url'
import gravel512Normal from '../../assets/surfaces/gravel/512/normal.ktx2?url'
import gravel512Orm from '../../assets/surfaces/gravel/512/orm.ktx2?url'
import gravel512Masks from '../../assets/surfaces/gravel/512/masks.ktx2?url'
import wood512Color from '../../assets/surfaces/wood/512/color.ktx2?url'
import wood512Normal from '../../assets/surfaces/wood/512/normal.ktx2?url'
import wood512Orm from '../../assets/surfaces/wood/512/orm.ktx2?url'
import wood512Masks from '../../assets/surfaces/wood/512/masks.ktx2?url'
import info from './bakes.json'

export const BAKE_INFO = info

export const BAKE_MAPS = {
  cast: { 512: { color: cast512Color, normal: cast512Normal, orm: cast512Orm, masks: cast512Masks } },
  panel: { 512: { color: panel512Color, normal: panel512Normal, orm: panel512Orm, masks: panel512Masks } },
  slab: { 512: { color: slab512Color, normal: slab512Normal, orm: slab512Orm, masks: slab512Masks } },
  stained: { 512: { color: stained512Color, normal: stained512Normal, orm: stained512Orm, masks: stained512Masks } },
  paint: { 512: { color: paint512Color, normal: paint512Normal, orm: paint512Orm, masks: paint512Masks } },
  brick: { 512: { color: brick512Color, normal: brick512Normal, orm: brick512Orm, masks: brick512Masks } },
  rust: { 512: { color: rust512Color, normal: rust512Normal, orm: rust512Orm, masks: rust512Masks } },
  metal: { 512: { color: metal512Color, normal: metal512Normal, orm: metal512Orm, masks: metal512Masks } },
  corrugated: { 512: { color: corrugated512Color, normal: corrugated512Normal, orm: corrugated512Orm, masks: corrugated512Masks } },
  asphalt: { 512: { color: asphalt512Color, normal: asphalt512Normal, orm: asphalt512Orm, masks: asphalt512Masks } },
  dirt: { 512: { color: dirt512Color, normal: dirt512Normal, orm: dirt512Orm, masks: dirt512Masks } },
  grass: { 512: { color: grass512Color, normal: grass512Normal, orm: grass512Orm, masks: grass512Masks } },
  gravel: { 512: { color: gravel512Color, normal: gravel512Normal, orm: gravel512Orm, masks: gravel512Masks } },
  wood: { 512: { color: wood512Color, normal: wood512Normal, orm: wood512Orm, masks: wood512Masks } },
} as const
