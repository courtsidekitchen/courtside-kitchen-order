/**
 * COMPLETE ORDER PROCESSING SYSTEM
 * Handles orders with modifiers, supply deduction, and refunds
 */

// Global state for modifiers in cart
let posItemModifiers = {}; // { productId: { modifierName: true } }

/**
 * Add product to cart with modifier support
 */
window.posAddToCart = (id) => {
  posCart[id] = (posCart[id] || 0) + 1;
  if (!posItemModifiers[id]) posItemModifiers[id] = {};
  renderPosCart();
};

/**
 * Toggle modifier for a cart item
 */
window.posToggleItemModifier = (productId, modifierName) => {
  if (!posItemModifiers[productId]) posItemModifiers[productId] = {};
  posItemModifiers[productId][modifierName] = !posItemModifiers[productId][modifierName];
  renderPosCart();
};

/**
 * Get effective modifiers for a product (from DB or defaults)
 */
function getEffectiveModifiers(product) {
  if (product.modifiers && Array.isArray(product.modifiers) && product.modifiers.length > 0) {
    return product.modifiers;
  }
  
  const category = (product.category || '').toLowerCase();
  const isShake = category.includes('shake');
  const isMilkTea = category.includes('milk tea');
  const isBanana = (product.name || '').toLowerCase().includes('banana');
  
  if (isMilkTea) return [{ name: 'Boba', price: 5 }];
  if (isShake && isBanana) return [{ name: 'Nutella', price: 30 }];
  
  return [];
}

/**
 * Calculate total with modifiers for display
 */
function calculateItemTotal(product, quantity, selectedModifiers = {}) {
  const basePrice = Number(product.price || 0);
  const mods = getEffectiveModifiers(product);
  
  let modifierCost = 0;
  mods.forEach(mod => {
    if (selectedModifiers[mod.name]) {
      modifierCost += Number(mod.price || 0);
    }
  });
  
  return (basePrice + modifierCost) * quantity;
}

/**
 * Build order items array with modifier tracking
 */
function buildOrderItems() {
  const items = [];
  let subtotal = 0;
  
  Object.entries(posCart).forEach(([productId, qty]) => {
    if (!qty || qty <= 0) return;
    
    // Handle standalone add-ons
    if (productId.startsWith('addon_')) {
      const addonKey = productId.replace('addon_', '');
      const addon = ADDON_DEFS && ADDON_DEFS[addonKey];
      if (!addon) return;
      
      const itemTotal = addon.price * qty;
      subtotal += itemTotal;
      items.push({
        productId: productId,
        name: addon.name,
        qty: qty,
        price: addon.price,
        modifiers: [],
        cogs: 0,
        recipe: []
      });
      return;
    }
    
    // Handle regular products
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const selectedMods = posItemModifiers[productId] || {};
    const effectiveMods = getEffectiveModifiers(product);
    
    let modifierCost = 0;
    const appliedModifiers = [];
    
    effectiveMods.forEach(mod => {
      if (selectedMods[mod.name]) {
        modifierCost += Number(mod.price || 0);
        appliedModifiers.push({
          name: mod.name,
          price: Number(mod.price || 0)
        });
      }
    });
    
    const finalPrice = Number(product.price || 0) + modifierCost;
    const itemTotal = finalPrice * qty;
    subtotal += itemTotal;
    
    // Build display name with modifiers
    let displayName = product.name;
    if (appliedModifiers.length > 0) {
      displayName += ` with ${appliedModifiers.map(m => m.name).join(' & ')}`;
    }
    
    items.push({
      productId: product.id,
      name: displayName,
      qty: qty,
      price: finalPrice,
      basePrice: Number(product.price || 0),
      modifiers: appliedModifiers,
      cogs: Number(product.cogs || 0),
      recipe: product.recipe || []
    });
  });
  
  return { items, subtotal };
}

/**
 * MAIN ORDER SUBMISSION - Complete flow
 */
window.submitPosOrder = async () => {
  if (!Object.keys(posCart).length) {
    return showPosToast('Cart is empty', '#dc2626');
  }
  
  const paymentMethod = document.getElementById('posPayment')?.value || 'Cash';
  const cashInput = document.getElementById('posCashTendered');
  const cashValue = cashInput ? Number(cashInput.value || 0) : 0;
  
  // Validate cash payment
  if (paymentMethod === 'Cash' && cashValue < currentFinalTotal) {
    const balance = currentFinalTotal - cashValue;
    return showPosToast(
      `Insufficient cash! Balance due: ₱${balance.toLocaleString()}`,
      '#dc2626'
    );
  }
  
  const btn = document.getElementById('posSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Processing Order...';
  }
  
  try {
    // Build order
    const { items, subtotal } = buildOrderItems();
    
    if (!items.length) {
      throw new Error('No items in order');
    }
    
    // Calculate discount
    const discountSelect = document.getElementById('posDiscountType');
    const discountType = discountSelect?.value || 'NONE';
    const discountOption = discountSelect?.selectedOptions?.[0];
    const discountPercent = Number(discountOption?.getAttribute('data-pct') || 0);
    const discountAmount = Math.round(subtotal * (discountPercent / 100));
    const netTotal = Math.max(0, subtotal - discountAmount);
    
    // Calculate change
    const changeGiven = paymentMethod === 'Cash' ? Math.max(0, cashValue - netTotal) : 0;
    
    // Get next order number
    const orderNum = await getNextPosOrderNumber();
    
    // Build order data
    const customer = document.getElementById('posCustomer')?.value?.trim() || 'Walk-in';
    const notes = document.getElementById('posNotes')?.value?.trim() || '';
    const pagerNo = document.getElementById('posPagerSelect')?.value || 'NONE';
    
    const orderData = {
      orderNumber: orderNum,
      orderSource: 'WALK_IN',
      orderType: 'WALK_IN',
      customerName: customer,
      pagerNumber: pagerNo,
      notes: notes,
      items: items,
      paymentMethod: paymentMethod,
      cashTendered: paymentMethod === 'Cash' ? cashValue : null,
      changeGiven: changeGiven,
      subtotal: subtotal,
      discountType: discountType,
      discountAmount: discountAmount,
      total: netTotal,
      status: 'ORDER_RECEIVED',
      createdAt: new Date().toISOString(),
      suppliesDeducted: false
    };
    
    // Save order to Firestore
    await setDoc(doc(db, 'orders', orderNum), orderData);
    
    // Deduct supplies based on recipe
    await deductSuppliesForItems(items);
    
    // Mark supplies as deducted
    await updateDoc(doc(db, 'orders', orderNum), { suppliesDeducted: true });
    
    // Success
    showPosToast(`✅ Order ${orderNum} submitted!`, '#15803d');
    
    // Print receipt if confirmed
    if (confirm('Print receipt?')) {
      window.printThermalReceipt(orderData);
    }
    
    // Reset form
    startNewTicket(true);
    
  } catch (error) {
    showPosToast(`Error: ${error.message}`, '#dc2626');
    console.error('Order submission error:', error);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ CHARGE & COMPLETE';
    }
  }
};

/**
 * DEDUCT SUPPLIES - Process recipe-based inventory
 */
async function deductSuppliesForItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return;
  
  try {
    for (const item of items) {
      const recipe = Array.isArray(item.recipe) ? item.recipe : [];
      const qtySold = Number(item.qty || 1);
      
      // Process each recipe component
      for (const component of recipe) {
        if (!component || !component.supplyId) continue;
        
        const supplyId = component.supplyId;
        const portionNeeded = (Number(component.portion || 1) * qtySold);
        
        try {
          await runTransaction(db, async (tx) => {
            const supplyRef = doc(db, 'supplies', supplyId);
            const supplySnap = await tx.get(supplyRef);
            
            if (supplySnap.exists()) {
              const currentStock = Number(
                supplySnap.data().stockLevel || 
                supplySnap.data().stock || 
                supplySnap.data().qty || 
                0
              );
              const newStock = Math.max(0, currentStock - portionNeeded);
              
              tx.update(supplyRef, {
                stockLevel: newStock,
                stock: newStock,
                qty: newStock,
                updatedAt: new Date().toISOString()
              });
            }
          });
        } catch (err) {
          console.warn(`Failed to deduct supply ${supplyId}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('Supply deduction error:', err);
  }
}

/**
 * RESTORE SUPPLIES - Reverse inventory on cancellation/refund
 */
async function restoreSuppliesForItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return;
  
  try {
    for (const item of items) {
      const recipe = Array.isArray(item.recipe) ? item.recipe : [];
      const qtySold = Number(item.qty || 1);
      
      for (const component of recipe) {
        if (!component || !component.supplyId) continue;
        
        const supplyId = component.supplyId;
        const portionToRestore = (Number(component.portion || 1) * qtySold);
        
        try {
          await runTransaction(db, async (tx) => {
            const supplyRef = doc(db, 'supplies', supplyId);
            const supplySnap = await tx.get(supplyRef);
            
            if (supplySnap.exists()) {
              const currentStock = Number(
                supplySnap.data().stockLevel || 
                supplySnap.data().stock || 
                supplySnap.data().qty || 
                0
              );
              const newStock = currentStock + portionToRestore;
              
              tx.update(supplyRef, {
                stockLevel: newStock,
                stock: newStock,
                qty: newStock,
                updatedAt: new Date().toISOString()
              });
            }
          });
        } catch (err) {
          console.warn(`Failed to restore supply ${supplyId}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('Supply restoration error:', err);
  }
}

/**
 * DECLINE ORDER - Restore supplies
 */
window.declineCustomerOrder = async (orderId) => {
  const reason = prompt('Reason for declining:', 'Payment could not be verified');
  if (reason === null) return;
  
  try {
    const order = hist.find(o => o.id === orderId || o.orderNumber === orderId);
    
    if (order) {
      // Restore supplies if they were deducted
      if (order.suppliesDeducted && Array.isArray(order.items)) {
        await restoreSuppliesForItems(order.items);
      }
      
      // Update order status
      await updateDoc(doc(db, 'orders', order.id || orderId), {
        status: 'DECLINED',
        suppliesDeducted: false,
        declineReason: reason,
        declinedAt: new Date().toISOString()
      });
      
      showPosToast('Order declined & supplies restored', '#dc2626');
    }
  } catch (err) {
    showPosToast(`Error: ${err.message}`, '#dc2626');
  }
};

/**
 * VOID ORDER - Restore supplies
 */
window.voidCustomerOrder = async (orderId) => {
  const reason = prompt('Reason for voiding:');
  if (reason === null) return;
  
  try {
    const order = hist.find(o => o.id === orderId || o.orderNumber === orderId);
    
    if (order) {
      if (order.suppliesDeducted && Array.isArray(order.items)) {
        await restoreSuppliesForItems(order.items);
      }
      
      await updateDoc(doc(db, 'orders', order.id || orderId), {
        status: 'VOIDED',
        suppliesDeducted: false,
        voidReason: reason,
        voidedAt: new Date().toISOString()
      });
      
      showPosToast('Order voided & supplies restored', '#dc2626');
    }
  } catch (err) {
    showPosToast(`Error: ${err.message}`, '#dc2626');
  }
};

/**
 * REFUND ORDER - Restore supplies
 */
window.refundCustomerOrder = async (orderId) => {
  const reason = prompt('Reason for refund:');
  if (reason === null) return;
  
  try {
    const order = hist.find(o => o.id === orderId || o.orderNumber === orderId);
    
    if (order) {
      if (order.suppliesDeducted && Array.isArray(order.items)) {
        await restoreSuppliesForItems(order.items);
      }
      
      await updateDoc(doc(db, 'orders', order.id || orderId), {
        status: 'REFUNDED',
        suppliesDeducted: false,
        refundReason: reason,
        refundedAt: new Date().toISOString()
      });
      
      showPosToast('Order refunded & supplies restored', '#15803d');
    }
  } catch (err) {
    showPosToast(`Error: ${err.message}`, '#dc2626');
  }
};

/**
 * Get next order number
 */
async function getNextPosOrderNumber() {
  const ref = doc(db, 'counters', 'pos_orders');
  let nextNum = 0;
  
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    nextNum = ((snap.data()?.lastNumber || 0) + 1);
    tx.set(ref, { lastNumber: nextNum }, { merge: true });
  });
  
  return `CK-POS-${String(nextNum).padStart(5, '0')}`;
}
