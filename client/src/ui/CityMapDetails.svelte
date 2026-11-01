<script lang="ts">
  import { CITY_MAP_FEATURES } from '../shared/cityMap.generated';
  import { CITY_LOCATIONS, CITY_RESIDENTS } from '../../../shared/city/catalogue';
  const { discovered = [], selected = null, residents = false }: { discovered?: readonly string[]; selected?: string | null; residents?: boolean } = $props();
  const colors: Record<string,string> = {gate:'#709cab',guest:'#b39675',fountain:'#70a6aa',garden:'#8fa475',mill:'#c0a47a',bakery:'#c58f70',dye:'#a28cad',school:'#c6af87',homes:'#bcac91',dock:'#94a4a1',gardens:'#80a080',palace:'#ccb179'};
</script>
<g class="city-map-details" transform="matrix(.8660254 .5 -.8660254 .5 0 0)" clip-path="url(#city-world-clip)">
  {#each CITY_MAP_FEATURES as feature}
    <polygon points={feature.points.map(p=>p.join(',')).join(' ')} fill={feature.kind==='building' ? colors[feature.district]??'#c2ac8a' : feature.kind==='structure'?'#b5a07a':'#8c9970'} stroke={selected===feature.district?'#086e70':'#806d54'} stroke-width={feature.kind==='building'?.32:.14} opacity={discovered.includes(feature.district)?.95:.38}/>
    {#if feature.kind==='building'}<polyline points={feature.points.slice(0,3).map(p=>p.join(',')).join(' ')} fill="none" stroke="#f6e8c5" stroke-width=".38"/>{/if}
  {/each}
  <!-- Authored landmarks: water, planted terraces, work spaces and trees. -->
  {#each CITY_LOCATIONS as place}
    {#if ['garden','gardens'].includes(place.id)}
      {#each [-1,0,1] as row}<path d={`M${place.x-5} ${place.z-4+row*1.6}h10`} stroke="#72936b" stroke-width=".6" stroke-dasharray=".45 .5" opacity=".8"/>{/each}
    {/if}
  {/each}
  {#if residents}
    {#each CITY_RESIDENTS.filter(person=>discovered.includes(person.location)) as person}
      <g transform={`translate(${person.x},${person.z})`}><circle r=".65" fill="#fff1cc" stroke="#6f5b46" stroke-width=".2"/><circle cy="-.1" r=".18" fill="#6f5b46"/><title>{person.name} — {person.role}</title></g>
    {/each}
  {/if}
</g>
