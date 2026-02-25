<template>
  <div class="app-shell p-6 space-y-6">
    <h1 class="text-3xl font-bold text-green-400 mb-2">SSH Proxy Manager</h1>

    <div class="border-b border-gray-700">
      <nav class="flex gap-2">
        <button @click="activeTab = 'servers'" :class="tabClass('servers')"><i class="fa-solid fa-server mr-2"></i>Servers</button>
        <button @click="activeTab = 'credentials'" :class="tabClass('credentials')"><i class="fa-solid fa-key mr-2"></i>Credentials</button>
        <button @click="activeTab = 'profiles'" :class="tabClass('profiles')"><i class="fa-solid fa-plug-circle-bolt mr-2"></i>Port Profiles</button>
        <button @click="showSettingsModal = true" class="ml-auto px-4 py-2 text-sm text-gray-200 hover:text-white">
          <i class="fa-solid fa-gear mr-2"></i>Settings
        </button>
      </nav>
    </div>

    <div v-if="activeTab === 'credentials'" class="card">
      <div class="flex gap-2">
        <input v-model="cred.label" placeholder="Label" class="input flex-1" />
        <input v-model="cred.username" placeholder="Username" class="input flex-1" />
        <input v-model="cred.password" placeholder="Password" class="input flex-1" />
        <button @click="addCredential" class="btn-success">Add</button>
      </div>
      <div v-for="c in credentials" :key="c.id" class="row-item justify-between">
        <span>{{ c.label }} ({{ c.username }})</span>
        <button @click="deleteCredential(c.id)" class="text-red-400"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>

    <div v-if="activeTab === 'profiles'" class="card">
      <div class="flex gap-2">
        <input v-model="profile.label" placeholder="Label" class="input flex-1" />
        <input v-model="profile.local_socks_port" placeholder="Local SOCKS Port" type="number" class="input w-44" />
        <button @click="addProfile" class="btn-success">Add</button>
      </div>
      <div v-for="p in profiles" :key="p.id" class="row-item justify-between">
        <span>{{ p.label }} (Port: {{ p.local_socks_port }})</span>
        <button @click="deleteProfile(p.id)" class="text-red-400"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>

    <div v-if="activeTab === 'servers'" class="card space-y-4">
      <div class="flex flex-wrap gap-2 items-center">
        <button @click="showBulkModal = true" class="btn-primary"><i class="fa-solid fa-file-import mr-2"></i>Bulk import</button>
        <button @click="showSingleModal = true" class="btn-success"><i class="fa-solid fa-plus mr-2"></i>Add single server</button>
        <button @click="testAll" :disabled="isTestingAll" class="btn-purple disabled:opacity-50 disabled:cursor-not-allowed">
          <i class="fa-solid" :class="isTestingAll ? 'fa-spinner fa-spin mr-2' : 'fa-gauge-high mr-2'"></i>
          {{ testAllLabel }}
        </button>
        <label class="flex items-center gap-2 text-sm text-gray-200 px-3 py-2 rounded bg-gray-700">
          <input v-model="settings.load_balance_enabled" type="checkbox" class="accent-green-500" @change="saveSettings" />
          <span>Auto Load Balance (Pinned)</span>
        </label>
        <button @click="sortBySavedSpeed" class="btn-muted"><i class="fa-solid fa-arrow-down-wide-short mr-2"></i>Sort by Saved Speed</button>
      </div>

      <div v-if="isTestingAll && currentTestingIp" class="text-xs text-purple-300">
        Testing now: <span class="font-semibold">{{ currentTestingIp }}</span>
      </div>

      <div v-for="s in servers" :key="s.id" :class="['server-card', s.status === 'CONNECTED' ? 'server-card-active' : '', s.is_pinned ? 'server-card-pinned' : '']">
        <div class="flex items-start justify-between gap-4">
          <div class="text-sm leading-5">
            <div class="font-semibold text-base flex items-center gap-2">
              <span>{{ s.country_flag || '🏳️' }}</span>
              <span>{{ s.ip }}</span>
              <span v-if="s.is_pinned" class="text-yellow-400" title="Pinned"><i class="fa-solid fa-thumbtack"></i></span>
              <span v-if="currentTestingServerId === s.id" class="text-purple-300 text-xs ml-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i>testing</span>
            </div>
            <div class="text-gray-300 flex flex-wrap gap-3 mt-1">
              <span><i class="fa-solid fa-circle-info mr-1"></i>{{ s.status || '-' }}</span>
              <span><i class="fa-solid fa-plug mr-1"></i>{{ s.best_port || '-' }}</span>
              <span><i class="fa-solid fa-tower-broadcast mr-1"></i>{{ s.socks_port || '-' }}</span>
              <span><i class="fa-solid fa-flag mr-1"></i>{{ s.country_code || '-' }}</span>
            </div>
          </div>

          <div class="text-right min-w-40">
            <div :class="['font-semibold', speedClass(s.last_speed_kbps)]">{{ displaySpeed(s.last_speed_kbps) }}</div>
            <div class="text-xs text-gray-400">SOCKS {{ s.last_latency_socks || '-' }} ms</div>
          </div>

          <div class="flex gap-2 flex-wrap justify-end">
            <button :title="s.is_pinned ? 'Unpin' : 'Pin on top'" @click="togglePin(s.id)" class="icon-btn bg-amber-500"><i class="fa-solid fa-thumbtack"></i></button>
            <button title="Connect" @click="connect(s.id)" class="icon-btn bg-green-600"><i class="fa-solid fa-plug-circle-check"></i></button>
            <button title="Disconnect" @click="disconnect(s.id)" class="icon-btn bg-yellow-600"><i class="fa-solid fa-plug-circle-xmark"></i></button>
            <button title="Test connected speed" @click="testSocks(s.id)" class="icon-btn bg-purple-600"><i class="fa-solid fa-gauge"></i></button>
            <button title="Test this server" @click="testOne(s.id)" class="icon-btn bg-blue-500"><i class="fa-solid fa-wave-square"></i></button>
            <button title="Delete" @click="deleteServer(s.id)" class="icon-btn bg-red-500"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSettingsModal" class="modal-overlay" @click.self="showSettingsModal = false">
      <div class="modal-box space-y-4">
        <h3 class="text-lg font-semibold">Settings</h3>

        <div class="space-y-2">
          <label class="text-sm text-gray-300">Connected proxy speed-check interval (minutes)</label>
          <input v-model="settings.speed_check_interval_min" type="number" min="1" class="input w-40" />
        </div>

        <div class="space-y-2">
          <label class="text-sm text-gray-300">Load balance interval (minutes)</label>
          <input v-model="settings.load_balance_interval_min" type="number" min="1" class="input w-40" />
        </div>

        <div class="space-y-2">
          <p class="text-sm text-gray-300">Rebuild geo data for existing servers (country code + flag).</p>
          <button class="btn-primary" @click="rebuildGeo">Rebuild / Update Existing Servers</button>
        </div>

        <div class="flex justify-end gap-2">
          <button class="btn-muted" @click="showSettingsModal = false">Close</button>
          <button class="btn-success" @click="saveSettings">Save</button>
        </div>
      </div>
    </div>

    <div v-if="showBulkModal" class="modal-overlay" @click.self="showBulkModal = false">
      <div class="modal-box space-y-3">
        <h3 class="text-lg font-semibold">Bulk import servers</h3>
        <textarea v-model="bulkIPs" placeholder="Enter IPs, one per line" class="input h-32 w-full"></textarea>
        <div class="flex gap-2 flex-wrap">
          <select v-model="selectedCredential" class="input">
            <option disabled value="">Select Credential</option>
            <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
          <select v-model="selectedProfile" class="input">
            <option disabled value="">Select Profile</option>
            <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
          <input v-model="optionalPort" placeholder="Optional Port" type="number" class="input w-36" />
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-muted" @click="showBulkModal = false">Cancel</button>
          <button class="btn-primary" @click="bulkImport">Import</button>
        </div>
      </div>
    </div>

    <div v-if="showSingleModal" class="modal-overlay" @click.self="showSingleModal = false">
      <div class="modal-box space-y-3">
        <h3 class="text-lg font-semibold">Add server</h3>
        <input v-model="server.ip" placeholder="IP (or IP:port)" class="input w-full" />
        <div class="flex gap-2 flex-wrap">
          <input v-model="server.optional_port" placeholder="Optional Port" type="number" class="input w-36" />
          <select v-model="server.credential_id" class="input">
            <option disabled value="">Select Credential</option>
            <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
          <select v-model="server.port_profile_id" class="input">
            <option disabled value="">Select Profile</option>
            <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-muted" @click="showSingleModal = false">Cancel</button>
          <button class="btn-success" @click="addServer">Add</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'

const activeTab = ref('servers')
const credentials = ref([])
const profiles = ref([])
const servers = ref([])
const bulkIPs = ref('')
const selectedCredential = ref('')
const selectedProfile = ref('')
const optionalPort = ref(null)
const showBulkModal = ref(false)
const showSingleModal = ref(false)
const showSettingsModal = ref(false)
const settings = ref({ speed_check_interval_min: 5, load_balance_enabled: false, load_balance_interval_min: 5 })
const isTestingAll = ref(false)
const currentTestingServerId = ref(null)
const currentTestingIp = ref('')

const cred = ref({ label: '', username: '', password: '' })
const profile = ref({ label: '', local_socks_port: '' })
const server = ref({ ip: '', optional_port: '', credential_id: '', port_profile_id: '' })

const testAllLabel = computed(() => {
  if (!isTestingAll.value) return 'Test All'
  return currentTestingIp.value ? `Testing ${currentTestingIp.value}` : 'Testing...'
})

function tabClass(tab) {
  return ['px-4 py-2 rounded-t text-sm', activeTab.value === tab ? 'bg-gray-700 text-white font-bold' : 'text-gray-400 hover:text-white']
}

function displaySpeed(value) {
  if (!value) return 'Speed: N/A'
  return `Speed: ${value} kbps`
}

function speedClass(value) {
  if (!value) return 'text-red-400'
  if (value >= 500) return 'text-green-400'
  if (value >= 150) return 'text-orange-400'
  return 'text-red-400'
}

async function loadCredentials() { credentials.value = await window.api.invoke('credentials:get') }
async function loadProfiles() { profiles.value = await window.api.invoke('profiles:get') }
async function loadServers() { servers.value = await window.api.invoke('servers:get') }
async function loadSettings() { settings.value = await window.api.invoke('settings:get') }

async function addCredential() { await window.api.invoke('credentials:add', { ...cred.value }); cred.value = { label: '', username: '', password: '' }; loadCredentials() }
async function deleteCredential(id) { await window.api.invoke('credentials:delete', id); loadCredentials() }

async function addProfile() { await window.api.invoke('profiles:add', { label: profile.value.label, local_socks_port: Number(profile.value.local_socks_port) }); profile.value = { label: '', local_socks_port: '' }; loadProfiles() }
async function deleteProfile(id) { await window.api.invoke('profiles:delete', id); loadProfiles() }

async function addServer() {
  await window.api.invoke('servers:add', {
    ip: server.value.ip,
    optional_port: server.value.optional_port ? Number(server.value.optional_port) : null,
    credential_id: Number(server.value.credential_id),
    port_profile_id: Number(server.value.port_profile_id)
  })
  showSingleModal.value = false
  server.value = { ip: '', optional_port: '', credential_id: '', port_profile_id: '' }
  loadServers()
}

async function deleteServer(id) { await window.api.invoke('servers:delete', id); loadServers() }
async function togglePin(id) { await window.api.invoke('servers:togglePin', id); loadServers() }
async function testOne(id) { await window.api.invoke('servers:testOne', id); loadServers() }

async function testAll() {
  if (isTestingAll.value) return
  isTestingAll.value = true
  currentTestingServerId.value = null
  currentTestingIp.value = ''
  try {
    await window.api.invoke('servers:testAll')
    await loadServers()
  } finally {
    isTestingAll.value = false
    currentTestingServerId.value = null
    currentTestingIp.value = ''
  }
}

async function sortBySavedSpeed() { await window.api.invoke('servers:sortBySavedSpeed'); loadServers() }
async function connect(id) { await window.api.invoke('ssh:connect', id); loadServers() }
async function disconnect(id) { await window.api.invoke('ssh:disconnect', id); loadServers() }
async function testSocks(id) { await window.api.invoke('ssh:testSocks', id); loadServers() }

async function saveSettings() {
  await window.api.invoke('settings:update', {
    speed_check_interval_min: Number(settings.value.speed_check_interval_min),
    load_balance_enabled: Boolean(settings.value.load_balance_enabled),
    load_balance_interval_min: Number(settings.value.load_balance_interval_min)
  })
  if (showSettingsModal.value) showSettingsModal.value = false
}

async function rebuildGeo() {
  await window.api.invoke('settings:rebuildGeo')
  loadServers()
}

async function bulkImport() {
  if (!bulkIPs.value.trim() || !selectedCredential.value || !selectedProfile.value) return
  const ips = bulkIPs.value.split('\n').map(v => v.trim()).filter(Boolean)
  await window.api.invoke('servers:bulkImport', {
    ips,
    credentialId: Number(selectedCredential.value),
    portProfileId: Number(selectedProfile.value),
    optionalPort: optionalPort.value ? Number(optionalPort.value) : null
  })
  bulkIPs.value = ''
  optionalPort.value = null
  showBulkModal.value = false
  loadServers()
}

onMounted(() => {
  loadCredentials(); loadProfiles(); loadServers(); loadSettings()
  window.api.receive('servers:updated', () => loadServers())
  window.api.receive('ui:openSettings', () => { showSettingsModal.value = true })
  window.api.receive('servers:testAllProgress', (payload) => {
    if (payload?.done) {
      currentTestingServerId.value = null
      currentTestingIp.value = ''
      return
    }

    currentTestingServerId.value = payload?.serverId || null
    currentTestingIp.value = payload?.ip || ''
  })
})
</script>
