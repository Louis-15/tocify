<script>
  import {fly} from 'svelte/transition';
  import {backOut} from 'svelte/easing';

  export let className = '';
  export let text = 'Tooltip text';
  export let position = 'top';
  export let width = 'w-48';
  export let isTextCopiable = false;
  // 是否将气泡限制在视口内（防止靠近窗口边缘时气泡溢出不可见）。
  // 开启后会在显示时用 JS 测量气泡与视口边界，必要时平移气泡使其完全可见。
  // 仅对非自定义位置（top/bottom/left/right）生效。
  export let constrainToViewport = false;

  export let color = 'bg-gradient-to-tr from-blue-300/70 to-pink-300/60 ';

  let isVisible = false;
  let timer = null;
  let isCopied = false;

  const delay = (func) => {
    return () => {
      timer = setTimeout(func, 300);
    };
  };

  const setVisible = () => {
    if (timer) clearTimeout(timer);
    isVisible = true;
  };

  const setInVisible = () => {
    isVisible = false;
    setTimeout(() => (isCopied = false), 300);
  };

  // constrainToViewport 模式下，气泡插入 DOM 的瞬间同步测量并修正位置，
  // 确保不超出视口。通过 Svelte action（use:）实现——action 在元素首次插入 DOM 时
  // 同步执行，早于 transition 的任何渲染帧，因此过渡动画会直接从修正后的位置开始播放，
  // 不会出现"先溢出再跳回"的闪烁。
  function constrainAction(node) {
    if (!constrainToViewport) return;
    const rect = node.getBoundingClientRect();
    const padding = 8; // 距视口边缘留 8px 安全间距
    let shiftX = 0;
    if (rect.left < padding) {
      shiftX = padding - rect.left; // 左溢出 → 右移
    } else if (rect.right > window.innerWidth - padding) {
      shiftX = (window.innerWidth - padding) - rect.right; // 右溢出 → 左移
    }
    if (shiftX !== 0) {
      // 覆盖默认的 -translate-x-1/2 居中偏移：改为 calc(-50% + shiftXpx)
      node.style.transform = `translateX(calc(-50% + ${shiftX}px))`;
    }
  }

  const copyText = () => {
    navigator.clipboard.writeText(text);
    isCopied = true;
    setTimeout(() => (isCopied = false), 1500);
  };

  const toUnit = (val) => {
    if (typeof val === 'number') return `${val * 100}%`;
    
    if (!isNaN(val) && !val.includes('%') && !val.includes('px')) {
       const num = parseFloat(val);
       if (Math.abs(num) <= 1) {
         return `${num * 100}%`;
       }
       return `${val}%`;
    }
    return val;
  };

  $: isCustomPosition = position.includes(' ');
  $: customCoords = isCustomPosition ? position.split(' ').map(toUnit) : [];
  
  $: customStyle = isCustomPosition  ? `left: ${customCoords[0]}; top: ${customCoords[1]}; margin: 0;` : '';

  const getFlyParams = (pos) => {
    if (isCustomPosition) return { y: 10 };
    switch (pos) {
      case 'top':
        return {y: 10};
      case 'bottom':
        return {y: -10};
      case 'left':
        return {x: 10};
      case 'right':
        return {x: -10};
      default:
        return {y: 10};
    }
  };
</script>

<div class={'relative inline-block font-mono' + className}>
  <div
    role="button"
    tabindex="0"
    class="cursor-pointer inline-block"
    on:mouseenter={setVisible}
    on:mouseleave={delay(setInVisible)}
  >
    <slot />
  </div>

  {#if isVisible}
    <button
      transition:fly={{...getFlyParams(position), duration: 300, easing: backOut}}
      on:mouseenter={setVisible}
      on:mouseleave={delay(setInVisible)}
      on:click={isTextCopiable ? copyText : null}
      use:constrainAction
      style={customStyle}
      class={`
        absolute z-50 p-2 md:px-4 md:py-3 font-mono text-sm text-gray-900 border-2 border-black
        shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]  rounded-md
        backdrop-blur-sm break-words
        whitespace-pre-line text-left ${width} ${color}
        ${isTextCopiable ? 'cursor-copy active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all' : ''}
        
        ${!isCustomPosition && position === 'top' ? 'bottom-full left-1/2 transform -translate-x-1/2 mb-3' : ''}
        ${!isCustomPosition && position === 'bottom' ? 'top-full left-1/2 transform -translate-x-1/2 mt-3' : ''}
        ${!isCustomPosition && position === 'left' ? 'right-full top-1/2 transform -translate-y-1/2 mr-3' : ''}
        ${!isCustomPosition && position === 'right' ? 'left-full top-1/2 transform -translate-y-1/2 ml-3' : ''}
      `}
    >
      <div class="relative z-10 drop-shadow-sm">
        {#if isCopied}
          <span class="inline-block uppercase tracking-widest font-black">COPIED!</span>
        {:else}
          {text}
        {/if}
      </div>
    </button>
  {/if}
</div>
