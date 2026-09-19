<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import MainLayout from './components/MainLayout.vue'

const route = useRoute()
const isBare = computed(() => route.meta.bare === true)
</script>

<template>
  <router-view v-if="isBare" />
  <MainLayout v-else />
</template>
